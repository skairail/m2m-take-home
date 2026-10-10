import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { FakeClock } from "../src/clock.js";
import type { Config } from "../src/config.js";
import { buildApp } from "../src/http/app.js";
import { pool } from "./pg.js";

export const TOKEN = "test-token";

export function testConfig(): Config {
  return {
    deviceToken: TOKEN,
    offlineThresholdSeconds: 300,
    databaseUrl: process.env.DATABASE_URL ?? "",
    port: 0,
  };
}

export async function createApp(
  clock = new FakeClock(new Date("2026-09-29T14:00:00Z")),
) {
  const app = await buildApp({
    config: testConfig(),
    pool,
    clock,
  });
  return { app, clock };
}

export function auth(token = TOKEN): { "x-device-token": string } {
  return { "x-device-token": token };
}

export async function postEvent(
  app: FastifyInstance,
  deviceId: string,
  body: string | object,
  token = TOKEN,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: `/devices/${deviceId}/events`,
    headers: {
      ...auth(token),
      "content-type": "application/json",
    },
    payload: body,
  });
}

export async function getDevice(
  app: FastifyInstance,
  deviceId: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "GET",
    url: `/devices/${deviceId}`,
    headers: auth(),
  });
}

export async function getDevices(
  app: FastifyInstance,
  status?: string,
): Promise<LightMyRequestResponse> {
  const query = status === undefined ? "" : `?status=${status}`;
  return app.inject({
    method: "GET",
    url: `/devices${query}`,
    headers: auth(),
  });
}

export function uuid(): string {
  return randomUUID();
}

export const ids = {
  a1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  h1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  b2: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
  h2: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
};
