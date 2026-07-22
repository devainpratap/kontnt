import { ApiError } from "../lib/api-error";

/**
 * Thrown by {@link JobRunnerRegistry.start} when a run is already in-flight for
 * the given (jobId, stepName). Extends ApiError so the Fastify error handler
 * surfaces it as a 409 with a machine-readable code, but callers can also catch
 * it explicitly to shape the response.
 */
export class StepAlreadyRunningError extends ApiError {
  constructor(jobId: string, stepName: string) {
    super("Step already running", 409, "STEP_ALREADY_RUNNING");
    this.name = "StepAlreadyRunningError";
    this.jobId = jobId;
    this.stepName = stepName;
  }

  readonly jobId: string;
  readonly stepName: string;
}

/**
 * In-memory, single-process execution registry. Tracks at most one in-flight
 * execution per (jobId, stepName) together with its AbortController so long
 * multi-minute Codex work can run detached from the HTTP request and be
 * cancelled. This is deliberately simple: the app runs as a single process, so
 * a plain Map is sufficient and there is no cross-process coordination.
 */
export class JobRunnerRegistry {
  private readonly inFlight = new Map<string, AbortController>();

  private key(jobId: string, stepName: string) {
    return `${jobId}::${stepName}`;
  }

  isRunning(jobId: string, stepName: string): boolean {
    return this.inFlight.has(this.key(jobId, stepName));
  }

  /**
   * Start `fn` detached (NOT awaited by the caller). If a run is already
   * in-flight for the same (jobId, stepName) this throws
   * {@link StepAlreadyRunningError} — the in-flight lock that prevents the
   * double-trigger race. On success the run is stored with an AbortController
   * whose signal is passed to `fn`, and is removed from the registry once it
   * settles. Any rejection is caught and logged so it can never become an
   * unhandled rejection: the underlying runner already persists status + errors
   * to the DB, so swallowing here is safe.
   */
  start(jobId: string, stepName: string, fn: (signal: AbortSignal) => Promise<unknown>): void {
    const key = this.key(jobId, stepName);
    if (this.inFlight.has(key)) {
      throw new StepAlreadyRunningError(jobId, stepName);
    }

    const controller = new AbortController();
    this.inFlight.set(key, controller);

    void (async () => {
      try {
        await fn(controller.signal);
      } catch (error) {
        // The runner persists failure/cancellation to the DB itself; this catch
        // exists only so a detached rejection cannot crash the process.
        console.error(`[job-runner] execution failed for ${key}:`, error);
      } finally {
        // Only clear if we are still the registered controller. In this
        // single-process model nothing else can replace it (starts are blocked
        // while in-flight), but the guard keeps the invariant explicit.
        if (this.inFlight.get(key) === controller) {
          this.inFlight.delete(key);
        }
      }
    })();
  }

  /**
   * Abort the in-flight run for (jobId, stepName) if present. Returns whether
   * something was actually cancelled. The aborted runner is responsible for
   * persisting the resulting step status (e.g. "failed" / "Cancelled by user").
   */
  cancel(jobId: string, stepName: string): boolean {
    const controller = this.inFlight.get(this.key(jobId, stepName));
    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }
}

export const jobRunner = new JobRunnerRegistry();
