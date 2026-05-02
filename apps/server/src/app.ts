import Fastify from "fastify";
import cors from "@fastify/cors";

import { registerRoutes } from "./routes";
import { ApiError } from "./lib/api-error";

export async function createServer() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const statusCode = error instanceof ApiError ? error.statusCode : 500;

    reply.code(statusCode).send({
      error: message,
      ...(error instanceof ApiError && error.code ? { code: error.code } : {})
    });
  });

  await registerRoutes(app);

  return app;
}
