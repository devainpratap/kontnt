import { createServer } from "./app";
import { ensureWorkspaceDirs, appConfig } from "./config";
import { initializeDatabase } from "./db/client";

async function main() {
  await ensureWorkspaceDirs();
  initializeDatabase();

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
