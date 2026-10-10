import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.js";
import {
  createApp,
  getDevice,
  getDevices,
  ids,
  postEvent,
  uuid,
} from "./helpers.js";
import { pool } from "./pg.js";

describe("routes", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;
  let clock: FakeClock;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("returns 201 with device_id and 200 for a duplicate without changing last_seen_at", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));
    const eventId = uuid();
    const body = {
      event_id: eventId,
      type: "armed",
      occurred_at: "2026-09-29T13:59:00Z",
      payload: { mode: "away", user_id: 3 },
    };

    const created = await postEvent(app, "panel-0042", body);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      device_id: "panel-0042",
      event_id: eventId,
      type: "armed",
      occurred_at: "2026-09-29T13:59:00Z",
      payload: { mode: "away", user_id: 3 },
    });

    clock.set(new Date("2026-09-29T14:04:00Z"));
    const duplicate = await postEvent(app, "panel-0042", body);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(created.json());

    const state = await getDevice(app, "panel-0042");
    expect(state.json().last_seen_at).toBe("2026-09-29T14:00:00Z");
  });

  it("computes online/offline from Clock at request time", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));

    await postEvent(app, "quiet-panel", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 50, rssi_dbm: -40 },
    });

    clock.set(new Date("2026-09-29T14:10:00Z"));
    await postEvent(app, "fresh-panel", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:10:00Z",
      payload: { battery_pct: 50, rssi_dbm: -40 },
    });

    const offline = await getDevices(app, "offline");
    expect(offline.json()).toEqual({
      devices: [
        {
          device_id: "quiet-panel",
          status: "offline",
          last_seen_at: "2026-09-29T14:00:00Z",
        },
      ],
    });

    const online = await getDevices(app, "online");
    expect(online.json()).toEqual({
      devices: [
        {
          device_id: "fresh-panel",
          status: "online",
          last_seen_at: "2026-09-29T14:10:00Z",
        },
      ],
    });
  });

  it("lists devices longest-silent first", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));
    await postEvent(app, "older", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 1, rssi_dbm: -1 },
    });
    clock.set(new Date("2026-09-29T14:01:00Z"));
    await postEvent(app, "newer", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:01:00Z",
      payload: { battery_pct: 1, rssi_dbm: -1 },
    });
    clock.set(new Date("2026-09-29T14:10:00Z"));

    const listed = await getDevices(app, "offline");
    expect(listed.json().devices.map((d: { device_id: string }) => d.device_id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("matches the assignment sequence for panel-0042", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));

    await postEvent(app, "panel-0042", {
      event_id: ids.a1,
      type: "armed",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { mode: "away", user_id: 3 },
    });
    clock.set(new Date("2026-09-29T14:01:00Z"));
    await postEvent(app, "panel-0042", {
      event_id: ids.h1,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:01:00Z",
      payload: { battery_pct: 87, rssi_dbm: -71 },
    });
    clock.set(new Date("2026-09-29T14:02:00Z"));
    const opened = await postEvent(app, "panel-0042", {
      event_id: ids.b2,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { sensor_id: 4 },
    });
    clock.set(new Date("2026-09-29T14:02:05Z"));
    const retry = await postEvent(app, "panel-0042", {
      event_id: ids.b2,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { sensor_id: 4 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(opened.json());

    clock.set(new Date("2026-09-29T14:06:30Z"));
    expect((await getDevice(app, "panel-0042")).json()).toEqual({
      device_id: "panel-0042",
      status: "online",
      last_seen_at: "2026-09-29T14:02:00Z",
      arm_state: "armed",
      arm_mode: "away",
      open_sensors: [4],
    });

    clock.set(new Date("2026-09-29T14:07:30Z"));
    expect((await getDevice(app, "panel-0042")).json()).toMatchObject({
      status: "offline",
      last_seen_at: "2026-09-29T14:02:00Z",
    });
  });
});
