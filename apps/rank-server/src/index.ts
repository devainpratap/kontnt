import { createRankServer } from "./app";
import { ClientRepository } from "./clients/repository";
import { ensureRankDirs, rankConfig } from "./config";
import { initializeRankDatabase } from "./db/client";

async function main() {
  await ensureRankDirs();
  initializeRankDatabase();

  // Recover sync runs left "running" by a previous crash before serving, so a
  // stale row cannot hold the in-flight lock forever.
  const reconciled = new ClientRepository().reconcileInterruptedRuns();
  if (reconciled > 0) {
    console.warn(`Reconciled ${reconciled} interrupted sync run(s) after restart`);
  }

  const app = await createRankServer();
  await app.listen({ host: rankConfig.host, port: rankConfig.port });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
