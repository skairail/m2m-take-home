import { afterEach, describe, expect, it } from "vitest";
import { TOKEN, createApp, getDevice, getDevices, postEvent, uuid } from "./helpers.js";
import { pool } from "./pg.js";

describe("validation", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("returns 400 for an unknown event type", async () => {
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

  it("returns 400 for sensor_id out of range", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { sensor_id: 65 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(true);
  });

  it("returns 400 for a bad timestamp", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "yesterday",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for an invalid device_id", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "bad id!", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns Fastify JSON parse errors in the shared format", async () => {
    ({ app } = await createApp());
    const response = await app.inject({
      method: "POST",
      url: "/devices/panel-0042/events",
      headers: {
        "x-device-token": TOKEN,
        "content-type": "application/json",
      },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: true,
      message: "invalid json body",
    });
  });

  it("returns 400 for an unknown status filter", async () => {
    ({ app } = await createApp());
    const response = await getDevices(app, "maybe");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: true,
      message: "status must be online or offline",
    });
  });

  it("returns 400 when status is missing", async () => {
    ({ app } = await createApp());
    const response = await getDevices(app);
    expect(response.statusCode).toBe(400);
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
});
