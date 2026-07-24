import type { KeywordRecord } from "@rankos/shared";

import { rankConfig } from "../config";
import { checkConcurrency, interCheckDelayMs } from "./provider";
import { RankCheckService, type CheckOutcome } from "./rank-check-service";

/**
 * Serialised, throttled batch checking.
 *
 * Concurrency is what gets an IP flagged fastest, so checks run strictly one at
 * a time with a randomised gap between them. The gap comes from the active
 * provider: 25-70s for the local browser (slow on purpose — speed there buys
 * nothing and costs the ability to check at all), about a second for API
 * providers, which have no block risk.
 *
 * The daily cap is a second, independent guard: even a runaway caller cannot
 * exceed SERP_MAX_CHECKS_PER_DAY.
 */

export type BatchProgress = {
  total: number;
  completed: number;
  ok: number;
  blocked: number;
  failed: number;
  /** Set when the batch stopped early, with the reason. */
  stoppedReason: string | null;
  outcomes: CheckOutcome[];
};

/**
 * Gap between checks, from the active provider.
 *
 * The 25-70s spacing exists solely because Google challenges the browser
 * driver. API providers have no such constraint, so a batch through them
 * finishes in minutes rather than hours.
 */
function randomDelayMs(): number {
  const { min, max } = interCheckDelayMs();
  return min + Math.floor(Math.random() * Math.max(1, max - min));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Consecutive blocks mean Google has started challenging this IP. Continuing
 * would waste the day's budget producing nothing but `blocked` rows and deepen
 * the block, so the batch stops and says so.
 */
const CONSECUTIVE_BLOCK_LIMIT = 3;

type BatchOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress) => void;
  /** Skip the inter-check delay. Tests only — never in normal operation. */
  noDelay?: boolean;
  /** Overrides the provider-derived concurrency. Tests pass 1 for serial order. */
  concurrency?: number;
};

function emptyProgress(total: number): BatchProgress {
  return { total, completed: 0, ok: 0, blocked: 0, failed: 0, stoppedReason: null, outcomes: [] };
}

function tally(progress: BatchProgress, outcome: CheckOutcome): void {
  progress.outcomes.push(outcome);
  progress.completed += 1;
  if (outcome.status === "ok" || outcome.status === "not-found") {
    progress.ok += 1;
  } else if (outcome.status === "blocked") {
    progress.blocked += 1;
  } else {
    progress.failed += 1;
  }
}

/**
 * Run a batch, one keyword at a time.
 *
 * This is the local-browser path: serialised with a long randomised gap, and it
 * stops early on a run of consecutive blocks because that means Google has
 * started challenging the IP and continuing only deepens the block.
 */
async function runSerial(
  keywords: KeywordRecord[],
  service: RankCheckService,
  options: BatchOptions
): Promise<BatchProgress> {
  const progress = emptyProgress(keywords.length);
  let consecutiveBlocks = 0;

  for (const [index, keyword] of keywords.entries()) {
    if (options.signal?.aborted) {
      progress.stoppedReason = "Cancelled.";
      break;
    }
    if (service.remainingToday() <= 0) {
      progress.stoppedReason = `Daily cap of ${rankConfig.serpMaxChecksPerDay} checks reached. Remaining keywords were not checked.`;
      break;
    }

    const outcome = await service.checkKeyword(keyword, options.signal);
    tally(progress, outcome);
    consecutiveBlocks = outcome.status === "blocked" ? consecutiveBlocks + 1 : 0;
    options.onProgress?.({ ...progress, outcomes: [...progress.outcomes] });

    if (consecutiveBlocks >= CONSECUTIVE_BLOCK_LIMIT) {
      progress.stoppedReason =
        `Stopped after ${consecutiveBlocks} consecutive blocked checks — Google is challenging this IP. ` +
        `Try again later, or switch SERP_PROVIDER to a paid source.`;
      break;
    }

    const isLast = index === keywords.length - 1;
    if (!isLast && !options.noDelay) {
      await sleep(randomDelayMs(), options.signal);
    }
  }

  return progress;
}

/**
 * Run a batch as a worker pool.
 *
 * This is the API path. There is no per-IP block risk, so the one-at-a-time
 * throttle is pure wasted wall-clock: `concurrency` workers pull from a shared
 * cursor, turning a 42-keyword batch from minutes into well under one. The
 * consecutive-block early stop does not apply here - a failing provider is
 * already handled by the failover chain, not by backing off an IP.
 */
async function runConcurrent(
  keywords: KeywordRecord[],
  service: RankCheckService,
  options: BatchOptions,
  concurrency: number
): Promise<BatchProgress> {
  const progress = emptyProgress(keywords.length);
  let cursor = 0;
  let stopped = false;

  async function worker(): Promise<void> {
    // `const index = cursor++` is atomic here: there is no await between the
    // read and the increment, and JS is single-threaded, so two workers can
    // never claim the same keyword.
    while (!stopped) {
      if (options.signal?.aborted) {
        progress.stoppedReason = "Cancelled.";
        stopped = true;
        break;
      }
      if (service.remainingToday() <= 0) {
        progress.stoppedReason = `Daily cap of ${rankConfig.serpMaxChecksPerDay} checks reached. Remaining keywords were not checked.`;
        stopped = true;
        break;
      }

      const index = cursor++;
      if (index >= keywords.length) {
        break;
      }

      const outcome = await service.checkKeyword(keywords[index], options.signal);
      tally(progress, outcome);
      options.onProgress?.({ ...progress, outcomes: [...progress.outcomes] });
    }
  }

  const workerCount = Math.min(concurrency, keywords.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return progress;
}

/**
 * Check a batch of keywords.
 *
 * Serial for the local browser (block avoidance), concurrent for API providers
 * (no block risk, so no reason to wait). The daily cap, cancellation, and
 * progress reporting behave the same either way.
 */
export async function runCheckBatch(
  keywords: KeywordRecord[],
  service: RankCheckService,
  options: BatchOptions = {}
): Promise<BatchProgress> {
  const concurrency = options.concurrency ?? checkConcurrency();
  return concurrency <= 1
    ? runSerial(keywords, service, options)
    : runConcurrent(keywords, service, options, concurrency);
}

/**
 * Which keywords are due, given their cadence and last check.
 *
 * Paused keywords are never due. A keyword that has never been checked is
 * always due, so newly added terms get a first reading promptly.
 */
export function selectDueKeywords(
  keywords: Array<KeywordRecord & { lastCheckedAt: string | null }>,
  now: Date = new Date()
): KeywordRecord[] {
  return keywords.filter((keyword) => {
    if (!keyword.isActive || keyword.cadence === "paused") {
      return false;
    }
    if (!keyword.lastCheckedAt) {
      return true;
    }

    const elapsedMs = now.getTime() - new Date(keyword.lastCheckedAt).getTime();
    const dueAfterMs = keyword.cadence === "daily" ? 20 * 3600_000 : 6.5 * 24 * 3600_000;
    return elapsedMs >= dueAfterMs;
  });
}
