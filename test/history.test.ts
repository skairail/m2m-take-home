import { afterEach, describe, expect, it } from "vitest";
import {
  createApp,
  getDeviceEvents,
  ids,
  postEvent,
  uuid,
} from "./helpers.js";
import { pool } from "./pg.js";

describe("history", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;

  afterEach(async () => {
    await app?.close();
    await pool.query("TRUNCATE events, device_state");
  });

  it("pages oldest-first and walks the full history", async () => {
    ({ app } = await createApp());
    await postEvent(app, "panel-0042", {
      event_id: ids.a1,
      type: "armed",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { mode: "away", user_id: 3 },
    });
    await postEvent(app, "panel-0042", {
      event_id: ids.h1,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:01:00Z",
      payload: { battery_pct: 87, rssi_dbm: -71 },
    });
    await postEvent(app, "panel-0042", {
      event_id: ids.b2,
      type: "sensor_opened",
      occurred_at: "2026-09-29T14:02:00Z",
      payload: { sensor_id: 4 },
    });

    const page1 = await getDeviceEvents(
      app,
      "panel-0042",
      "?since=2026-09-29T13:00:00Z&limit=2",
    );
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.events.map((e: { event_id: string }) => e.event_id)).toEqual([
      ids.a1,
      ids.h1,
    ]);
    expect(body1.next).toMatch(
      /^\/devices\/panel-0042\/events\?since=2026-09-29T14%3A01%3A00Z&after_id=\d+&limit=2$/,
    );

    const page2 = await app.inject({
      method: "GET",
      url: body1.next,
      headers: { "x-device-token": "test-token" },
    });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(1);
    expect(body2.events[0].event_id).toBe(ids.b2);
    expect(body2.next).toBeNull();
  });

  it("returns an empty page for a device with no matching events", async () => {
    ({ app } = await createApp());
    await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 10, rssi_dbm: -80 },
    });

    const response = await getDeviceEvents(
      app,
      "panel-0042",
      "?since=2026-09-29T15:00:00Z",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events: [], next: null });
  });

  it("breaks ties on occurred_at using the internal id", async () => {
    ({ app } = await createApp());
    const first = await postEvent(app, "panel-0042", {
      event_id: ids.a1,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 1, rssi_dbm: -1 },
    });
    const second = await postEvent(app, "panel-0042", {
      event_id: ids.h1,
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 2, rssi_dbm: -2 },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const page1 = await getDeviceEvents(app, "panel-0042", "?limit=1");
    const body1 = page1.json();
    expect(body1.events).toHaveLength(1);
    expect(body1.events[0].event_id).toBe(ids.a1);
    expect(body1.next).toContain("since=2026-09-29T14%3A00%3A00Z");
    expect(body1.next).toContain("after_id=");

    const page2 = await app.inject({
      method: "GET",
      url: body1.next,
      headers: { "x-device-token": "test-token" },
    });
    expect(page2.json().events.map((e: { event_id: string }) => e.event_id)).toEqual([
      ids.h1,
    ]);
    expect(page2.json().next).toBeNull();
  });

  it("treats since as inclusive", async () => {
    ({ app } = await createApp());
    await postEvent(app, "panel-0042", {
      event_id: ids.a1,
      type: "armed",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { mode: "stay", user_id: 1 },
    });
    const response = await getDeviceEvents(
      app,
      "panel-0042",
      "?since=2026-09-29T14:00:00Z",
    );
    expect(response.json().events[0].event_id).toBe(ids.a1);
  });

  it("returns 400 for invalid since, limit, or after_id", async () => {
    ({ app } = await createApp());
    await postEvent(app, "panel-0042", {
      event_id: uuid(),
      type: "heartbeat",
      occurred_at: "2026-09-29T14:00:00Z",
      payload: { battery_pct: 10, rssi_dbm: -80 },
    });

    const badSince = await getDeviceEvents(app, "panel-0042", "?since=nope");
    expect(badSince.statusCode).toBe(400);
    expect(badSince.json()).toEqual({
      error: true,
      message: "since must be an ISO 8601 timestamp",
    });

    const badLimit = await getDeviceEvents(app, "panel-0042", "?limit=0");
    expect(badLimit.statusCode).toBe(400);

    const tooBig = await getDeviceEvents(app, "panel-0042", "?limit=501");
    expect(tooBig.statusCode).toBe(400);

    const badAfter = await getDeviceEvents(
      app,
      "panel-0042",
      "?since=2026-09-29T14:00:00Z&after_id=abc",
    );
    expect(badAfter.statusCode).toBe(400);
  });

  it("returns 401 when the token is missing", async () => {
    ({ app } = await createApp());
    const response = await app.inject({
      method: "GET",
      url: "/devices/panel-0042/events",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: true, message: "unauthorized" });
  });

  it("returns 404 for a device that has never sent an event", async () => {
    ({ app } = await createApp());
    const response = await getDeviceEvents(app, "never-seen");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: true,
      message: "device not found",
    });
  });
});
