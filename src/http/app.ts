import Fastify from "fastify";
import type { Pool } from "pg";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import { errorBody, sendError } from "./errors.js";

export async function buildApp(_opts: {
  config: Config;
  pool: Pool;
  clock: Clock;
  logger?: boolean;
}) {
  const app = Fastify({ logger: _opts.logger ?? false });

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

  await app.ready();
  return app;
}
