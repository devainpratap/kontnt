/**
 * In-flight lock for long-running syncs.
 *
 * A 16-month backfill takes minutes. The route fires the work detached and
 * returns 202 immediately; progress is observed by polling sync_runs. This lock
 * is what stops an impatient second click from running two syncs over the same
 * window concurrently — which would not corrupt data (every write is an upsert)
 * but would double the API quota spend for nothing.
 *
 * Mirrors the job-runner pattern already proven in ContentOS.
 */

type RunningEntry = {
  controller: AbortController;
  startedAt: number;
  promise: Promise<unknown>;
};

const running = new Map<string, RunningEntry>();

function key(clientId: string, kind: string): string {
  return `${clientId}::${kind}`;
}

export function isRunning(clientId: string, kind: string): boolean {
  return running.has(key(clientId, kind));
}

/** Any sync currently in flight for this client, whatever the kind. */
export function hasAnyRunning(clientId: string): boolean {
  for (const entry of running.keys()) {
    if (entry.startsWith(`${clientId}::`)) {
      return true;
    }
  }
  return false;
}

export function listRunning(): Array<{ clientId: string; kind: string; startedAt: number }> {
  return [...running.entries()].map(([entryKey, value]) => {
    const [clientId, kind] = entryKey.split("::");
    return { clientId, kind, startedAt: value.startedAt };
  });
}

/**
 * Start work under the lock. Returns false when a run of the same kind is
 * already in flight, so the caller can answer 409 rather than queueing.
 */
export function start(
  clientId: string,
  kind: string,
  work: (signal: AbortSignal) => Promise<unknown>
): boolean {
  const entryKey = key(clientId, kind);
  if (running.has(entryKey)) {
    return false;
  }

  const controller = new AbortController();
  const promise = work(controller.signal)
    .catch((error) => {
      // The sync service already recorded the failure in sync_runs; log here so
      // a detached failure is not invisible in the terminal.
      console.error(`[rankos] ${kind} failed for client ${clientId}:`, error?.message ?? error);
    })
    .finally(() => {
      running.delete(entryKey);
    });

  running.set(entryKey, { controller, startedAt: Date.now(), promise });
  return true;
}

export function cancel(clientId: string, kind: string): boolean {
  const entry = running.get(key(clientId, kind));
  if (!entry) {
    return false;
  }
  entry.controller.abort();
  return true;
}

/** Await all in-flight work. Used on shutdown and by tests. */
export async function drain(): Promise<void> {
  await Promise.allSettled([...running.values()].map((entry) => entry.promise));
}
