import { afterEach, describe, expect, it } from "vitest";
import { createApp, postEvent, uuid } from "./helpers.js";
import { pool } from "./pg.js";

describe("auth", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("returns 401 before 400 when the token is missing", async () => {
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

  it("accepts the configured token", async () => {
    ({ app } = await createApp());
    const response = await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 80, rssi_dbm: -60 },
    });
    expect(response.statusCode).toBe(201);
  });
});
