import { existsSync } from "node:fs";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { rankConfig } from "./config";
import { ApiError } from "./lib/api-error";
import { registerRankRoutes } from "./routes";

export async function createRankServer() {
  const app = Fastify({ logger: true });

  // Reflect only explicitly allowlisted origins rather than any origin.
  await app.register(cors, { origin: rankConfig.corsAllowedOrigins });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const statusCode = error instanceof ApiError ? error.statusCode : 500;

    reply.code(statusCode).send({
      error: message,
      ...(error instanceof ApiError && error.code ? { code: error.code } : {})
    });
  });

  await registerRankRoutes(app);

  // Optionally serve the built frontend so everything runs on one origin.
  if (rankConfig.serveWeb && existsSync(rankConfig.webDistPath)) {
    await app.register(fastifyStatic, { root: rankConfig.webDistPath, wildcard: false });

    // SPA fallback for non-/api routes; unknown API routes stay JSON 404s.
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api")) {
        reply.code(404).send({ error: "Not found." });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
