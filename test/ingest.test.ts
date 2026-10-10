import { afterEach, describe, expect, it } from "vitest";
import { createRepository } from "../src/db/repository.js";
import { pool } from "./pg.js";

const repo = createRepository(pool);

function uuid(): string {
  return crypto.randomUUID();
}

async function deviceRow(deviceId: string) {
  const result = await pool.query(
    `SELECT last_seen_at, arm_state, arm_mode, open_sensors
     FROM device_state
     WHERE device_id = $1`,
    [deviceId],
  );
  return result.rows[0] as
    | {
        last_seen_at: Date;
        arm_state: string;
        arm_mode: string | null;
        open_sensors: number[];
      }
    | undefined;
}

describe("ingest", () => {
  afterEach(async () => {
    await pool.query("TRUNCATE events, device_state");
  });

  it("inserts a new event, applies state, and ignores a retry", async () => {
    const deviceId = "panel-0042";
    const eventId = uuid();
    const occurredAt = new Date("2026-09-29T13:59:00Z");
    const firstSeen = new Date("2026-09-29T14:00:00Z");
    const event = {
      event_id: eventId,
      type: "armed" as const,
      occurred_at: occurredAt,
      payload: { mode: "away" as const, user_id: 3 },
    };

    const created = await repo.ingest(deviceId, event, firstSeen);
    expect(created.created).toBe(true);
    expect(created.event).toMatchObject({
      device_id: deviceId,
      event_id: eventId,
      type: "armed",
      payload: { mode: "away", user_id: 3 },
    });
    expect(created.event.occurred_at).toEqual(occurredAt);
    expect(created.event.received_at).toEqual(firstSeen);

    const retry = await repo.ingest(
      deviceId,
      event,
      new Date("2026-09-29T14:04:00Z"),
    );
    expect(retry.created).toBe(false);
    expect(retry.event).toEqual(created.event);

    const state = await deviceRow(deviceId);
    expect(state?.last_seen_at).toEqual(firstSeen);
    expect(state?.arm_state).toBe("armed");
    expect(state?.arm_mode).toBe("away");
  });

  it("returns the stored event when the same event_id arrives with a different payload", async () => {
    const deviceId = "panel-1";
    const eventId = uuid();
    const now = new Date("2026-09-29T14:00:00Z");
    const original = {
      event_id: eventId,
      type: "sensor_opened" as const,
      occurred_at: now,
      payload: { sensor_id: 4 },
    };

    const created = await repo.ingest(deviceId, original, now);
    const retry = await repo.ingest(
      deviceId,
      { ...original, payload: { sensor_id: 9 } },
      new Date("2026-09-29T14:01:00Z"),
    );

    expect(retry.created).toBe(false);
    expect(retry.event).toEqual(created.event);
    expect((await deviceRow(deviceId))?.open_sensors).toEqual([4]);
  });

  it("does not re-apply a duplicate after the sensor was closed", async () => {
    const deviceId = "panel-1";
    const now = new Date("2026-09-29T14:00:00Z");
    const opened = {
      event_id: uuid(),
      type: "sensor_opened" as const,
      occurred_at: now,
      payload: { sensor_id: 4 },
    };

    await repo.ingest(deviceId, opened, now);
    await repo.ingest(
      deviceId,
      {
        event_id: uuid(),
        type: "sensor_closed",
        occurred_at: new Date("2026-09-29T14:00:01Z"),
        payload: { sensor_id: 4 },
      },
      new Date("2026-09-29T14:00:01Z"),
    );
    await repo.ingest(deviceId, opened, new Date("2026-09-29T14:00:02Z"));

    expect((await deviceRow(deviceId))?.open_sensors).toEqual([]);
  });

  it("keeps concurrent retries from inserting twice or moving last_seen_at", async () => {
    const deviceId = "panel-race";
    const now = new Date("2026-09-29T14:00:00Z");
    const event = {
      event_id: uuid(),
      type: "heartbeat" as const,
      occurred_at: now,
      payload: { battery_pct: 50, rssi_dbm: -40 },
    };

    const [a, b] = await Promise.all([
      repo.ingest(deviceId, event, now),
      repo.ingest(deviceId, event, now),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.event.event_id).toBe(event.event_id);
    expect(b.event).toEqual(a.event);

    const count = await pool.query(
      `SELECT count(*)::int AS n FROM events WHERE device_id = $1`,
      [deviceId],
    );
    expect(count.rows[0].n).toBe(1);
    expect((await deviceRow(deviceId))?.last_seen_at).toEqual(now);
  });

  it("serializes concurrent new events for one device so no update is lost", async () => {
    const deviceId = "panel-race";
    const now = new Date("2026-09-29T14:00:00Z");
    const sensorIds = Array.from({ length: 20 }, (_, i) => i + 1);

    await Promise.all(
      sensorIds.map((sensor_id) =>
        repo.ingest(
          deviceId,
          {
            event_id: uuid(),
            type: "sensor_opened",
            occurred_at: now,
            payload: { sensor_id },
          },
          now,
        ),
      ),
    );

    expect((await deviceRow(deviceId))?.open_sensors.sort((a, b) => a - b)).toEqual(
      sensorIds,
    );
  });

  it("keeps the newest last_seen_at when an older request commits later", async () => {
    const deviceId = "panel-late";
    const heartbeat = () => ({
      event_id: uuid(),
      type: "heartbeat" as const,
      occurred_at: new Date("2026-09-29T14:00:00Z"),
      payload: { battery_pct: 50, rssi_dbm: -40 },
    });
    const newer = new Date("2026-09-29T14:10:00Z");

    await repo.ingest(deviceId, heartbeat(), newer);
    await repo.ingest(deviceId, heartbeat(), new Date("2026-09-29T14:00:00Z"));

    expect((await deviceRow(deviceId))?.last_seen_at).toEqual(newer);
  });
});
