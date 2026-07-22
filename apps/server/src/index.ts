import { createServer } from "./app";
import { ensureWorkspaceDirs, appConfig } from "./config";
import { initializeDatabase } from "./db/client";
import { JobRepository } from "./jobs/repository";

async function main() {
  await ensureWorkspaceDirs();
  initializeDatabase();

  // Recover steps left "running" by a previous crash/restart before serving.
  const reconciled = new JobRepository().reconcileInterruptedSteps();
  if (reconciled.steps > 0) {
    console.warn(
      `Reconciled ${reconciled.steps} interrupted step(s) across ${reconciled.jobs} job(s) after restart`
    );
  }

  const app = await createServer();
  await app.listen({
    host: appConfig.host,
    port: appConfig.port
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
