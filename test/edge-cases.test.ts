import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.js";
import { buildApp } from "../src/http/app.js";
import {
  createApp,
  getDevice,
  getDevices,
  postEvent,
  testConfig,
  uuid,
} from "./helpers.js";
import { pool } from "./pg.js";

describe("edge cases", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;
  let clock: FakeClock;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("is online at exactly 5:00 and offline at 5:00.001", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:02:00Z")),
    ));
    await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });

    clock.set(new Date("2026-09-29T14:07:00Z"));
    expect((await getDevice(app, "panel-0042")).json().status).toBe("online");

    clock.set(new Date("2026-09-29T14:07:00.001Z"));
    expect((await getDevice(app, "panel-0042")).json().status).toBe("offline");
  });

  it("returns the stored event when a duplicate arrives with a different payload", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));
    const eventId = uuid();
    const created = await postEvent(app, "panel-0042", {
      event_id: eventId,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 4 },
    });
    expect(created.statusCode).toBe(201);

    clock.set(new Date("2026-09-29T14:01:00Z"));
    const retry = await postEvent(app, "panel-0042", {
      event_id: eventId,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 9 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(created.json());
    expect((await getDevice(app, "panel-0042")).json()).toMatchObject({
      open_sensors: [4],
      last_seen_at: "2026-09-29T14:00:00Z",
    });
  });

  it("logs a warning when a duplicate event_id has a different payload", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    app = await buildApp({
      config: testConfig(),
      pool,
      clock: new FakeClock(new Date("2026-09-29T14:00:00Z")),
      logger: { level: "warn", stream },
    });
    const eventId = uuid();
    await postEvent(app, "panel-0042", {
      event_id: eventId,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 4 },
    });
    await postEvent(app, "panel-0042", {
      event_id: eventId,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 9 },
    });
    expect(lines.join("")).toContain(
      "duplicate event_id with different payload; returning stored event",
    );
  });

  it("does not warn when a heartbeat retry is identical", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    app = await buildApp({
      config: testConfig(),
      pool,
      clock: new FakeClock(new Date("2026-09-29T14:00:00Z")),
      logger: { level: "warn", stream },
    });
    const body = {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 87, rssi_dbm: -71 },
    };
    expect((await postEvent(app, "panel-0042", body)).statusCode).toBe(201);
    expect((await postEvent(app, "panel-0042", body)).statusCode).toBe(200);
    expect(lines.join("")).not.toContain("duplicate event_id");
  });

  it("applies the 5:00 boundary to GET /devices the same way as GET /devices/:id", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:02:00Z")),
    ));
    await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    const ids = async (status: string) =>
      (await getDevices(app!, status))
        .json()
        .devices.map((d: { device_id: string }) => d.device_id);

    clock.set(new Date("2026-09-29T14:07:00Z"));
    expect(await ids("online")).toEqual(["panel-0042"]);
    expect(await ids("offline")).toEqual([]);

    clock.set(new Date("2026-09-29T14:07:00.001Z"));
    expect(await ids("online")).toEqual([]);
    expect(await ids("offline")).toEqual(["panel-0042"]);
  });

  it("rejects occurred_at without a time zone, impossible dates, and non-ISO strings", async () => {
    ({ app } = await createApp());
    for (const occurred_at of [
      "2026-09-29T14:00:00",
      "2026-02-31T00:00:00Z",
      "Sep 29 2026",
      "0",
      "-200000-01-01T00:00:00Z",
      1727618400000,
    ]) {
      const response = await postEvent(app, "panel-0042", {
        event_id: uuid(),
        type: "heartbeat",
        occurred_at,
        payload: { battery_pct: 80, rssi_dbm: -60 },
      });
      expect(response.statusCode, String(occurred_at)).toBe(400);
      expect(response.json()).toEqual({
        error: true,
        message: "occurred_at must be an ISO 8601 timestamp with a time zone",
      });
    }
  });

  it("accepts an explicit offset and returns occurred_at in UTC", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T17:00:00+03:00",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().occurred_at).toBe("2026-09-29T14:00:00Z");
  });

  it("returns 413 rather than 500 for an oversized body", async () => {
    ({ app } = await createApp());
    const response = await postEvent(
      app,
      "panel-0042",
      JSON.stringify({ pad: "x".repeat(1_100_000) }),
    );
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: true, message: "payload too large" });
  });

  it("records sensor_closed for a never-opened sensor without changing open_sensors", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "sensor_closed",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 4 },
    });
    expect(response.statusCode).toBe(201);
    expect((await getDevice(app, "panel-0042")).json()).toMatchObject({
      open_sensors: [],
      arm_state: "disarmed",
    });
  });

  it("returns 400 for sensor_id 0 and 65", async () => {
    ({ app } = await createApp());
    for (const sensor_id of [0, 65]) {
      const response = await postEvent(app, "panel-0042", {
        event_id: uuid(),
        type: "sensor_opened",
        occurred_at: "2026-09-29T14:00:00Z",
        payload: { sensor_id },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe(true);
    }
  });

  it("returns 400 for an unknown type", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "explode",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: true,
      message:
        "type must be one of armed, disarmed, sensor_opened, sensor_closed, heartbeat",
    });
  });

  it("returns 400 for a bad occurred_at", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "yesterday",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(true);
  });

  it("returns 401 when the token is missing, before validating the body", async () => {
    ({ app } = await createApp());
    const response = await app.inject({
      method: "POST",
      url: "/devices/panel-0042/events",
      headers: { "content-type": "application/json" },
      payload: { not: "an event" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: true, message: "unauthorized" });
  });

  it("returns 401 for the wrong token", async () => {
    ({ app } = await createApp());
    const response = await postEvent(
      app,
      "panel-0042",
      {
        event_id: uuid(),
        type: "heartbeat",
        occurred_at: "2026-09-29T14:00:00Z",
        payload: { battery_pct: 80, rssi_dbm: -60 },
      },
      "wrong",
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: true, message: "unauthorized" });
  });

  it("returns 404 for a device that has never sent an event", async () => {
    ({ app } = await createApp());
    const response = await getDevice(app, "never-seen");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: true,
      message: "device not found",
    });
  });

  it("returns an empty list for GET /devices when nothing matches", async () => {
    ({ app } = await createApp());
    expect((await getDevices(app, "online")).json()).toEqual({ devices: [] });
    expect((await getDevices(app, "offline")).json()).toEqual({ devices: [] });
  });

  it("returns 400 for an unknown status", async () => {
    ({ app } = await createApp());
    const response = await getDevices(app, "maybe");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: true,
      message: "status must be online or offline",
    });
  });

  it("accepts the same event_id ten times in parallel with a single 201 and one row", async () => {
    const setup = await createApp();
    app = setup.app;
    const eventId = uuid();
    const body = {
      event_id: eventId,
      type: "heartbeat" as const,
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 50, rssi_dbm: -40 },
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postEvent(setup.app, "panel-race", body),
      ),
    );

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(9);
    expect(new Set(results.map((r) => JSON.stringify(r.json()))).size).toBe(1);

    const count = await pool.query(
      `SELECT count(*)::int AS n FROM events WHERE device_id = $1 AND event_id = $2`,
      ["panel-race", eventId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
