import { existsSync } from "node:fs";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { appConfig } from "./config";
import { registerRoutes } from "./routes";
import { ApiError } from "./lib/api-error";

export async function createServer() {
  const app = Fastify({
    logger: true
  });

  // Reflect only explicitly allowlisted origins rather than any origin. When
  // the built frontend is served same-origin (SERVE_WEB) cross-origin access is
  // not needed at all, so an empty allowlist simply blocks all cross-origin use.
  await app.register(cors, {
    origin: appConfig.corsAllowedOrigins
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

  // Optionally serve the built frontend so the whole app runs on a single
  // origin/port in production. Gated on SERVE_WEB and the dist being present so
  // the dev workflow (separate Vite server) is unaffected.
  if (appConfig.serveWeb && existsSync(appConfig.webDistPath)) {
    await app.register(fastifyStatic, {
      root: appConfig.webDistPath,
      wildcard: false
    });

    // SPA fallback: serve index.html for non-/api routes that did not match a
    // static file, while keeping unknown API routes as JSON 404s.
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
