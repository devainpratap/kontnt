import type { JobFileBundle } from "@semantic-seo/shared";

/**
 * Tracks what server value a piece of local form state was last seeded from.
 * `signature` is a stable string representation of the server content, so we
 * can tell an unrelated background refetch (same content, new object identity)
 * apart from the server genuinely producing new content.
 */
export type Seed = { jobId: string; signature: string };

/**
 * Decide whether local editable state should be re-seeded from the server.
 *
 * Returns true only when:
 *  - nothing has been seeded yet, or
 *  - the job changed (navigated to a different job), or
 *  - the server content actually changed.
 *
 * It deliberately returns false when the server content is unchanged, even if
 * the surrounding job object is a brand-new reference (which happens on every
 * mutation → invalidate → refetch cycle). That is what protects unsaved edits.
 */
export function shouldSeed(seed: Seed | null, jobId: string, signature: string): boolean {
  if (!seed) {
    return true;
  }

  if (seed.jobId !== jobId) {
    return true;
  }

  return seed.signature !== signature;
}

/** The outline value the server currently considers canonical. */
export function resolveServerOutline(
  files: Pick<JobFileBundle, "approvedOutline" | "outline"> | null | undefined
): string {
  if (!files) {
    return "";
  }

  return files.approvedOutline ?? files.outline ?? "";
}
