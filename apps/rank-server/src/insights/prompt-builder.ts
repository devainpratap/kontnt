import type { ClientRecord } from "@rankos/shared";

import type { InsightStats, Movement } from "./stats";

/**
 * Rendering the computed statistics into a prompt.
 *
 * Claude receives *only* what is written here: a set of finished tables and an
 * instruction to interpret them. It never sees raw rows and is told explicitly
 * not to compute anything, because the failure mode being avoided — a
 * confidently wrong total in a document that goes to a paying client — is worse
 * than a blander report.
 *
 * Every table here is small by construction (top 10s), so the whole prompt fits
 * comfortably in context and the model has no reason to summarise or sample.
 */

function fmt(value: number): string {
  return value.toLocaleString();
}

function signed(value: number): string {
  return value > 0 ? `+${fmt(value)}` : fmt(value);
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function position(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function movementTable(rows: Movement[], emptyNote: string): string {
  if (rows.length === 0) {
    return `_${emptyNote}_`;
  }

  const lines = [
    "| Query | Clicks | Prev | Change | Impressions | Position | Prev position |",
    "|---|---:|---:|---:|---:|---:|---:|"
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.query} | ${fmt(row.clicks)} | ${fmt(row.previousClicks)} | ${signed(row.clickDelta)} | ` +
        `${fmt(row.impressions)} | ${position(row.position)} | ${position(row.previousPosition)} |`
    );
  }

  return lines.join("\n");
}

function shortPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "") || "/";
}

/** The statistics block. Also written to disk beside the report as an audit trail. */
export function renderStatsSection(stats: InsightStats): string {
  const totals = stats.totals;

  const decayTable =
    stats.decayingPages.length === 0
      ? "_No pages lost meaningful traffic this period._"
      : [
          "| Page | Clicks | Prev | Change | Impressions change | Likely cause |",
          "|---|---:|---:|---:|---:|---|",
          ...stats.decayingPages.map(
            (row) =>
              `| ${shortPath(row.page)} | ${fmt(row.clicks)} | ${fmt(row.previousClicks)} | ` +
              `${signed(row.clickDelta)} | ${pct(row.impressionChangePct)} | ${
                row.cause === "ctr"
                  ? "CTR (visibility held, clicks fell)"
                  : row.cause === "ranking"
                    ? "Ranking (lost visibility)"
                    : "Mixed"
              } |`
          )
        ].join("\n");

  const cannibalTable =
    stats.cannibalisation.length === 0
      ? "_No queries have multiple pages competing meaningfully._"
      : stats.cannibalisation
          .map(
            (entry) =>
              `- **${entry.query}** (${fmt(entry.impressions)} impressions) — ` +
              entry.pages.map((page) => `${shortPath(page.page)} (pos ${page.position.toFixed(1)})`).join(" vs ")
          )
          .join("\n");

  return [
    `## Headline (${stats.window.startDate} to ${stats.window.endDate}, vs ${stats.previousWindow.startDate} to ${stats.previousWindow.endDate})`,
    "",
    "| Metric | This period | Previous | Change |",
    "|---|---:|---:|---:|",
    `| Clicks | ${fmt(totals.clicks)} | ${fmt(totals.previousClicks)} | ${pct(totals.clickDeltaPct)} |`,
    `| Impressions | ${fmt(totals.impressions)} | ${fmt(totals.previousImpressions)} | ${pct(totals.impressionDeltaPct)} |`,
    `| CTR | ${(totals.ctr * 100).toFixed(2)}% | ${(totals.previousCtr * 100).toFixed(2)}% | — |`,
    `| Avg position | ${position(totals.position)} | ${position(totals.previousPosition)} | — |`,
    "",
    `Attribution coverage: ${fmt(stats.coverage.attributedClicks)} of ${fmt(stats.coverage.totalClicks)} clicks ` +
      `(${Math.round(stats.coverage.coverageRatio * 100)}%) are attributable to named queries. Google withholds rare ` +
      `queries, so the tables below will never sum to the headline.`,
    "",
    "## Biggest gains",
    "",
    movementTable(stats.winners, "No queries gained clicks this period."),
    "",
    "## Biggest losses",
    "",
    movementTable(stats.losers, "No queries lost clicks this period."),
    "",
    "## New queries earning clicks",
    "",
    movementTable(stats.newQueries, "No genuinely new queries this period."),
    "",
    "## Queries that stopped earning clicks",
    "",
    movementTable(stats.lostQueries, "No queries dropped to zero clicks."),
    "",
    "## Striking distance (real volume, just off the click-earning positions)",
    "",
    movementTable(stats.strikingDistance, "No striking-distance opportunities in this window."),
    "",
    "## Pages losing traffic",
    "",
    decayTable,
    "",
    "## Queries with more than one page competing",
    "",
    cannibalTable
  ].join("\n");
}

/**
 * The short WhatsApp brief prompt.
 *
 * Same statistics as the detailed report - so the two forms can never disagree
 * on a number - but a completely different shape: a message someone pastes into
 * a team group and reads in fifteen seconds. Wins first, because that is what
 * the operator asked for and what keeps a group channel worth reading.
 *
 * The formatting rules are WhatsApp-specific (single-asterisk bold, no tables,
 * no markdown headings) because those are what render in the destination. A
 * report that arrives full of broken `|` table pipes is worse than no report.
 */
export function buildBriefPrompt(client: ClientRecord, stats: InsightStats): string {
  return [
    `Write a short WhatsApp update for the team group about **${client.name}**'s SEO this week.`,
    "",
    "Here are the pre-computed statistics. They are correct. Interpret them; do not recalculate.",
    "",
    "---",
    "",
    renderStatsSection(stats),
    "",
    "---",
    "",
    "## What to write",
    "",
    "A single WhatsApp message, 120 to 180 words, that a team lead reads in fifteen seconds. Structure:",
    "",
    `1. One opening line naming the client and the period, e.g. *${client.name} - SEO this week*.`,
    "2. Lead with the wins: the two or three biggest genuine improvements, with the actual numbers.",
    "3. Then, briefly, the one thing that needs attention - a single line, not a list.",
    "4. End with the single most useful action for the week.",
    "",
    "## Rules",
    "",
    "- This is WhatsApp, not a document. Use *single asterisks* for bold. No markdown headings (#), no tables, no pipes.",
    "- Short lines. A blank line between sections. A little emoji is fine (one per section at most) but do not overdo it.",
    "- Use only the numbers in the statistics above. Do not calculate anything new. If it is not in the data, do not say it.",
    "- Lead with what improved. Keep the problem to one line so the message stays upbeat and forward-looking.",
    "- Plain language a non-specialist teammate understands. No jargon.",
    "- Never use em dashes or en dashes; use a plain hyphen with spaces.",
    "- Output only the message. No preamble, no explanation of what you wrote, no sign-off.",
    ...(client.brandTerms.length > 0
      ? [`- Branded searches (${client.brandTerms.join(", ")}) are excluded from opportunities; do not present them as SEO wins.`]
      : [])
  ].join("\n");
}

/**
 * The full prompt.
 *
 * The constraints are stated as flat prohibitions rather than preferences,
 * because the one thing that must not happen is a plausible-sounding number
 * that is not in the data.
 */
export function buildInsightPrompt(client: ClientRecord, stats: InsightStats): string {
  return [
    `You are writing the weekly SEO performance report for **${client.name}** (${client.primaryDomain}).`,
    "",
    "Below are pre-computed statistics from the client's own Google Search Console data.",
    "They are already correct. Your job is to interpret and prioritise them, not to recalculate them.",
    "",
    "---",
    "",
    renderStatsSection(stats),
    "",
    "---",
    "",
    "## What to write",
    "",
    "Produce a client-ready report in Markdown with these sections:",
    "",
    "1. **Summary** — three or four sentences an account manager could read aloud. What happened, and does it matter?",
    "2. **What went well** — the genuine wins, with the numbers from the tables above.",
    "3. **What needs attention** — losses and decay. For each, say whether the cause is visibility (ranking) or the listing (CTR), using the 'Likely cause' column rather than guessing.",
    "4. **Opportunities** — the striking-distance queries. Say which are worth pursuing and why. Ignore any whose intent clearly does not match what this business sells, and say so when you skip one.",
    "5. **Recommended actions** — at most five, each concrete and tied to a specific query or page from the tables.",
    "",
    "## Rules",
    "",
    "- **Use only the numbers in the tables above.** Do not calculate new totals, percentages, averages, or projections. If a figure is not in a table, do not state it.",
    "- If a table is empty, say so plainly. Do not invent entries to fill a section.",
    "- Average position is impression-weighted across every query variant, device, and location. It is not a live ranking. Do not describe it as 'ranking number N'.",
    "- Do not claim causation you cannot see in the data. 'Impressions fell' is an observation; 'Google's update hurt us' is a guess.",
    "- Write plainly for a business owner, not an SEO specialist. No jargon without a short explanation.",
    "- No preamble, no sign-off, no meta-commentary. Start with the heading and end with the last recommendation.",
    "- Never use em dashes or en dashes. Use a plain hyphen with spaces.",
    ...(client.brandTerms.length > 0
      ? [
          `- Branded queries (${client.brandTerms.join(", ")}) were excluded from the opportunity analysis, because they rank on brand recognition rather than SEO. Mention this only if relevant.`
        ]
      : [])
  ].join("\n");
}
