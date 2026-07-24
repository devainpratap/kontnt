import type { KeywordRecord } from "@rankos/shared";

import { rankConfig } from "../config";
import { interCheckDelayMs } from "./provider";
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

export async function runCheckBatch(
  keywords: KeywordRecord[],
  service: RankCheckService,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: BatchProgress) => void;
    /** Skip the inter-check delay. Tests only — never in normal operation. */
    noDelay?: boolean;
  } = {}
): Promise<BatchProgress> {
  const progress: BatchProgress = {
    total: keywords.length,
    completed: 0,
    ok: 0,
    blocked: 0,
    failed: 0,
    stoppedReason: null,
    outcomes: []
  };

  let consecutiveBlocks = 0;

  for (const [index, keyword] of keywords.entries()) {
    if (options.signal?.aborted) {
      progress.stoppedReason = "Cancelled.";
      break;
    }

    // Re-checked every iteration rather than once up front, so a batch started
    // near the cap stops at the right point.
    if (service.remainingToday() <= 0) {
      progress.stoppedReason = `Daily cap of ${rankConfig.serpMaxChecksPerDay} checks reached. Remaining keywords were not checked.`;
      break;
    }

    const outcome = await service.checkKeyword(keyword, options.signal);
    progress.outcomes.push(outcome);
    progress.completed += 1;

    if (outcome.status === "ok" || outcome.status === "not-found") {
      progress.ok += 1;
      consecutiveBlocks = 0;
    } else if (outcome.status === "blocked") {
      progress.blocked += 1;
      consecutiveBlocks += 1;
    } else {
      progress.failed += 1;
      consecutiveBlocks = 0;
    }

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
