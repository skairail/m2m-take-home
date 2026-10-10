import Fastify, { type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import { createRepository, type Repository } from "../db/repository.js";
import { tokensMatch } from "./auth.js";
import { errorBody, sendError } from "./errors.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(opts: {
  config: Config;
  pool: Pool;
  clock: Clock;
  logger?: FastifyServerOptions["logger"];
  repo?: Repository;
}) {
  const app = Fastify({ logger: opts.logger ?? false });
  const repo = opts.repo ?? createRepository(opts.pool);

  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers["x-device-token"];
    const provided = typeof header === "string" ? header : null;
    if (!provided || !tokensMatch(provided, opts.config.deviceToken)) {
      return sendError(reply, 401, "unauthorized");
    }
  });

  app.setNotFoundHandler((_request, reply) => {
    sendError(reply, 404, "not found");
  });

  app.setErrorHandler((err, request, reply) => {
    const status =
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      typeof err.statusCode === "number"
        ? err.statusCode
        : 500;

    if (status === 400 || status === 415) {
      return sendError(reply, 400, "invalid json body");
    }

    request.log.error(err);
    return reply.status(500).send(errorBody("internal server error"));
  });

  registerRoutes(app, {
    repo,
    clock: opts.clock,
    config: opts.config,
  });

  await app.ready();
  return app;
}
