import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.js";
import { createApp, getDevice, getDevices, ids, postEvent } from "./helpers.js";
import { pool } from "./pg.js";

describe("worked example", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;
  let clock: FakeClock;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("matches the assignment sequence for panel-0042", async () => {
    ({ app, clock } = await createApp(
      new FakeClock(new Date("2026-09-29T14:00:00Z")),
    ));

    clock.set(new Date("2026-09-29T14:00:00Z"));
    const armed = await postEvent(app, "panel-0042", {
      event_id: ids.a1,
      type: "armed",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { mode: "away", user_id: 3 },
    });
    expect(armed.statusCode).toBe(201);

    clock.set(new Date("2026-09-29T14:01:00Z"));
    const heartbeat = await postEvent(app, "panel-0042", {
      event_id: ids.h1,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:01:00Z",
      payload: { battery_pct: 87, rssi_dbm: -71 },
    });
    expect(heartbeat.statusCode).toBe(201);

    clock.set(new Date("2026-09-29T14:02:00Z"));
    const opened = await postEvent(app, "panel-0042", {
      event_id: ids.b2,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { sensor_id: 4 },
    });
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toEqual({
      device_id: "panel-0042",
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
    expect((await getDevice(app, "panel-0042")).json().last_seen_at).toBe(
      "2026-09-29T14:02:00Z",
    );

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
    expect((await getDevice(app, "panel-0042")).json()).toEqual({
      device_id: "panel-0042",
      status: "offline",
      last_seen_at: "2026-09-29T14:02:00Z",
      arm_state: "armed",
      arm_mode: "away",
      open_sensors: [4],
    });
    expect((await getDevices(app, "offline")).json()).toEqual({
      devices: [
        {
          device_id: "panel-0042",
          status: "offline",
          last_seen_at: "2026-09-29T14:02:00Z",
        },
      ],
    });

    clock.set(new Date("2026-09-29T14:08:00Z"));
    const back = await postEvent(app, "panel-0042", {
      event_id: ids.h2,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:08:00Z",
      payload: { battery_pct: 87, rssi_dbm: -71 },
    });
    expect(back.statusCode).toBe(201);
    expect((await getDevice(app, "panel-0042")).json()).toMatchObject({
      status: "online",
      last_seen_at: "2026-09-29T14:08:00Z",
      arm_state: "armed",
      arm_mode: "away",
      open_sensors: [4],
    });

    const stored = await pool.query(
      "SELECT event_id FROM events WHERE device_id = $1 ORDER BY occurred_at, id",
      ["panel-0042"],
    );
    expect(stored.rows.map((row) => row.event_id)).toEqual([
      ids.a1,
      ids.h1,
      ids.b2,
      ids.h2,
    ]);
  });
});
