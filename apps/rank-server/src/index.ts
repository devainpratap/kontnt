import { createRankServer } from "./app";
import { ClientRepository } from "./clients/repository";
import { ensureRankDirs, rankConfig } from "./config";
import { initializeRankDatabase } from "./db/client";
import { InsightService } from "./insights/insight-service";
import { backfillOnBoot, startScheduler } from "./scheduler/scheduler";

async function main() {
  await ensureRankDirs();
  initializeRankDatabase();

  // Recover sync runs left "running" by a previous crash before serving, so a
  // stale row cannot hold the in-flight lock forever.
  const reconciled = new ClientRepository().reconcileInterruptedRuns();
  if (reconciled > 0) {
    console.warn(`Reconciled ${reconciled} interrupted sync run(s) after restart`);
  }

  // Same for reports interrupted mid-generation - otherwise a stuck "running"
  // insight makes the UI poll forever and keeps the generate button spinning.
  const reconciledInsights = new InsightService().reconcileInterruptedInsights();
  if (reconciledInsights > 0) {
    console.warn(`Reconciled ${reconciledInsights} interrupted report(s) after restart`);
  }

  const app = await createRankServer();
  await app.listen({ host: rankConfig.host, port: rankConfig.port });

  // Start the scheduler and fill any GSC gap from downtime, after the server is
  // listening so a slow backfill never delays readiness. Failures here must not
  // take the server down - it is still fully usable manually.
  startScheduler();
  backfillOnBoot().catch((error) => console.error("[scheduler] boot backfill failed:", error?.message ?? error));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
