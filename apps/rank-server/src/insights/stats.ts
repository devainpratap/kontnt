/**
 * The deterministic analysis engine.
 *
 * Every number in a client report is computed here, in TypeScript, from rows
 * already in the database. Claude receives the finished table and is asked only
 * to narrate and prioritise it — it never sees raw rows and never does
 * arithmetic.
 *
 * That split is the whole design. An LLM handed 5,000 rows and asked "what
 * changed" produces confident, wrong totals, and a report that is wrong about a
 * client's traffic is worse than no report. It is the same lesson already
 * encoded in ContentOS's audit-and-repair loops: code does the deterministic
 * part, the model does the language.
 */

export type QueryPeriodRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type PagePeriodRow = {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type PeriodPair = {
  current: QueryPeriodRow[];
  previous: QueryPeriodRow[];
};

export type Movement = {
  query: string;
  clicks: number;
  previousClicks: number;
  clickDelta: number;
  impressions: number;
  previousImpressions: number;
  position: number;
  previousPosition: number | null;
  positionDelta: number | null;
};

/**
 * Why a page lost clicks.
 *
 * The distinction drives completely different fixes, so it is computed rather
 * than left for the model to guess:
 *   - impressions held but clicks fell  → the listing is losing the click (CTR)
 *   - impressions fell too              → the page is losing visibility (ranking)
 */
export type DecayCause = "ctr" | "ranking" | "mixed";

export type DecayingPage = {
  page: string;
  clicks: number;
  previousClicks: number;
  clickDelta: number;
  impressions: number;
  previousImpressions: number;
  impressionChangePct: number;
  cause: DecayCause;
};

export type CannibalisedQuery = {
  query: string;
  impressions: number;
  pages: Array<{ page: string; impressions: number; clicks: number; position: number }>;
};

export type InsightStats = {
  window: { startDate: string; endDate: string; days: number };
  previousWindow: { startDate: string; endDate: string };
  totals: {
    clicks: number;
    previousClicks: number;
    clickDelta: number;
    clickDeltaPct: number | null;
    impressions: number;
    previousImpressions: number;
    impressionDeltaPct: number | null;
    ctr: number;
    previousCtr: number;
    position: number | null;
    previousPosition: number | null;
  };
  coverage: { totalClicks: number; attributedClicks: number; coverageRatio: number };
  winners: Movement[];
  losers: Movement[];
  newQueries: Movement[];
  lostQueries: Movement[];
  strikingDistance: Movement[];
  decayingPages: DecayingPage[];
  cannibalisation: CannibalisedQuery[];
};

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / previous) * 100;
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Join two periods of query data into per-query movements.
 *
 * A query present in only one period still appears, with zeros on the other
 * side, so genuinely new and genuinely lost queries are not silently dropped.
 * `previousPosition` is null when there is no prior reading, because a position
 * delta against nothing is meaningless.
 */
export function buildMovements(pair: PeriodPair): Movement[] {
  const previousByQuery = new Map<string, QueryPeriodRow>();
  for (const row of pair.previous) {
    previousByQuery.set(normalise(row.query), row);
  }

  const movements: Movement[] = [];
  const seen = new Set<string>();

  for (const row of pair.current) {
    const key = normalise(row.query);
    seen.add(key);
    const previous = previousByQuery.get(key);

    movements.push({
      query: row.query,
      clicks: row.clicks,
      previousClicks: previous?.clicks ?? 0,
      clickDelta: row.clicks - (previous?.clicks ?? 0),
      impressions: row.impressions,
      previousImpressions: previous?.impressions ?? 0,
      position: row.position,
      previousPosition: previous ? previous.position : null,
      // Negative means the position number fell, which is an improvement.
      positionDelta: previous ? row.position - previous.position : null
    });
  }

  // Queries that existed before and have now vanished entirely.
  for (const [key, previous] of previousByQuery) {
    if (seen.has(key)) {
      continue;
    }
    movements.push({
      query: previous.query,
      clicks: 0,
      previousClicks: previous.clicks,
      clickDelta: -previous.clicks,
      impressions: 0,
      previousImpressions: previous.impressions,
      position: 0,
      previousPosition: previous.position,
      positionDelta: null
    });
  }

  return movements;
}

/** Biggest click gains, largest first. Only genuine gains qualify. */
export function pickWinners(movements: Movement[], limit = 10): Movement[] {
  return movements
    .filter((movement) => movement.clickDelta > 0)
    .sort((a, b) => b.clickDelta - a.clickDelta)
    .slice(0, limit);
}

/** Biggest click losses, largest first. */
export function pickLosers(movements: Movement[], limit = 10): Movement[] {
  return movements
    .filter((movement) => movement.clickDelta < 0)
    .sort((a, b) => a.clickDelta - b.clickDelta)
    .slice(0, limit);
}

/**
 * Queries earning clicks now that earned none before.
 *
 * Requires prior impressions to be zero too — a query that had impressions but
 * no clicks is not "new", it just started converting, which is a different
 * story.
 */
export function pickNewQueries(movements: Movement[], limit = 10): Movement[] {
  return movements
    .filter((movement) => movement.previousImpressions === 0 && movement.impressions > 0 && movement.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);
}

/** Queries that had clicks last period and have none now. */
export function pickLostQueries(movements: Movement[], limit = 10): Movement[] {
  return movements
    .filter((movement) => movement.previousClicks > 0 && movement.clicks === 0)
    .sort((a, b) => b.previousClicks - a.previousClicks)
    .slice(0, limit);
}

/**
 * Queries with real impression volume sitting just off the positions that earn
 * clicks. The single most actionable list in the report.
 */
export function pickStrikingDistance(
  movements: Movement[],
  options: { minImpressions?: number; minPosition?: number; maxPosition?: number; limit?: number } = {}
): Movement[] {
  const minImpressions = options.minImpressions ?? 50;
  const minPosition = options.minPosition ?? 4;
  const maxPosition = options.maxPosition ?? 20;

  return movements
    .filter(
      (movement) =>
        movement.impressions >= minImpressions &&
        movement.position >= minPosition &&
        movement.position <= maxPosition
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, options.limit ?? 10);
}

/**
 * Pages losing clicks, labelled with why.
 *
 * `impressionChangePct` within ±15% counts as "held steady", so a page whose
 * visibility is unchanged but whose clicks fell is a CTR problem — a title and
 * meta description fix, not a ranking campaign.
 */
export function pickDecayingPages(
  current: PagePeriodRow[],
  previous: PagePeriodRow[],
  options: { minPreviousClicks?: number; limit?: number } = {}
): DecayingPage[] {
  const minPreviousClicks = options.minPreviousClicks ?? 5;
  const previousByPage = new Map(previous.map((row) => [row.page, row]));

  const decaying: DecayingPage[] = [];

  for (const row of current) {
    const before = previousByPage.get(row.page);
    if (!before || before.clicks < minPreviousClicks) {
      continue;
    }

    const clickDelta = row.clicks - before.clicks;
    if (clickDelta >= 0) {
      continue;
    }

    const impressionChangePct = pctChange(row.impressions, before.impressions) ?? 0;

    // Held steady, clicks fell → the listing is losing the click.
    // Visibility fell → the page is losing the ranking.
    const cause: DecayCause =
      impressionChangePct > -15 ? "ctr" : impressionChangePct < -40 ? "ranking" : "mixed";

    decaying.push({
      page: row.page,
      clicks: row.clicks,
      previousClicks: before.clicks,
      clickDelta,
      impressions: row.impressions,
      previousImpressions: before.impressions,
      impressionChangePct,
      cause
    });
  }

  return decaying.sort((a, b) => a.clickDelta - b.clickDelta).slice(0, options.limit ?? 10);
}

/**
 * Queries where more than one page competes meaningfully.
 *
 * Uses the same 20%-of-leader threshold as the keyword suggester, for the
 * reason established there: counting every URL that ever appeared flags almost
 * everything, because a page that surfaced on three days with five impressions
 * is noise, not competition.
 */
export function pickCannibalisation(
  rows: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>,
  options: { minImpressions?: number; limit?: number } = {}
): CannibalisedQuery[] {
  const minImpressions = options.minImpressions ?? 100;
  const byQuery = new Map<string, Array<{ page: string; impressions: number; clicks: number; position: number }>>();

  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push({ page: row.page, impressions: row.impressions, clicks: row.clicks, position: row.position });
    byQuery.set(row.query, list);
  }

  const result: CannibalisedQuery[] = [];

  for (const [query, pages] of byQuery) {
    const totalImpressions = pages.reduce((sum, page) => sum + page.impressions, 0);
    if (totalImpressions < minImpressions) {
      continue;
    }

    const leader = Math.max(...pages.map((page) => page.impressions));
    const threshold = Math.max(10, leader * 0.2);
    const competing = pages.filter((page) => page.impressions >= threshold);

    if (competing.length < 2) {
      continue;
    }

    result.push({
      query,
      impressions: totalImpressions,
      pages: competing.sort((a, b) => b.impressions - a.impressions)
    });
  }

  return result.sort((a, b) => b.impressions - a.impressions).slice(0, options.limit ?? 10);
}

/** Assemble the complete statistics bundle a report is written from. */
export function buildInsightStats(input: {
  window: { startDate: string; endDate: string; days: number };
  previousWindow: { startDate: string; endDate: string };
  currentQueries: QueryPeriodRow[];
  previousQueries: QueryPeriodRow[];
  currentPages: PagePeriodRow[];
  previousPages: PagePeriodRow[];
  queryPageRows: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>;
  totals: { clicks: number; impressions: number; ctr: number; position: number | null };
  previousTotals: { clicks: number; impressions: number; ctr: number; position: number | null };
  coverage: { totalClicks: number; attributedClicks: number; coverageRatio: number };
}): InsightStats {
  const movements = buildMovements({ current: input.currentQueries, previous: input.previousQueries });

  return {
    window: input.window,
    previousWindow: input.previousWindow,
    totals: {
      clicks: input.totals.clicks,
      previousClicks: input.previousTotals.clicks,
      clickDelta: input.totals.clicks - input.previousTotals.clicks,
      clickDeltaPct: pctChange(input.totals.clicks, input.previousTotals.clicks),
      impressions: input.totals.impressions,
      previousImpressions: input.previousTotals.impressions,
      impressionDeltaPct: pctChange(input.totals.impressions, input.previousTotals.impressions),
      ctr: input.totals.ctr,
      previousCtr: input.previousTotals.ctr,
      position: input.totals.position,
      previousPosition: input.previousTotals.position
    },
    coverage: input.coverage,
    winners: pickWinners(movements),
    losers: pickLosers(movements),
    newQueries: pickNewQueries(movements),
    lostQueries: pickLostQueries(movements),
    strikingDistance: pickStrikingDistance(movements),
    decayingPages: pickDecayingPages(input.currentPages, input.previousPages),
    cannibalisation: pickCannibalisation(input.queryPageRows)
  };
}
