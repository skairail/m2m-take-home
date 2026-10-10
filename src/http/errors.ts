import type { FastifyReply } from "fastify";

export type ErrorBody = {
  error: true;
  message: string;
};

export function errorBody(message: string): ErrorBody {
  return { error: true, message };
}

export function sendError(
  reply: FastifyReply,
  status: number,
  message: string,
): FastifyReply {
  return reply.status(status).send(errorBody(message));
}

export function formatUtc(date: Date): string {
  return date.toISOString().replace(/\.000Z$/, "Z");
}
