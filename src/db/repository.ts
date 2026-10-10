import type { Pool, PoolClient } from "pg";
import {
  applyEvent,
  type DeviceState,
  type EventPayload,
  type EventType,
  type NewEvent,
  type StoredEvent,
} from "../domain/index.js";

type EventRow = {
  id: string;
  device_id: string;
  event_id: string;
  type: EventType;
  occurred_at: Date;
  received_at: Date;
  payload: EventPayload;
};

type DeviceRow = {
  device_id: string;
  last_seen_at: Date;
  arm_state: "armed" | "disarmed";
  arm_mode: "away" | "stay" | null;
  open_sensors: number[];
};

export type IngestResult = {
  created: boolean;
  event: StoredEvent;
};

export type DeviceRecord = DeviceState;

export type Repository = {
  ingest(
    deviceId: string,
    event: NewEvent,
    now: Date,
  ): Promise<IngestResult>;
  getDevice(deviceId: string): Promise<DeviceRecord | null>;
  listDevicesByLastSeen(
    now: Date,
    offlineAfterMs: number,
    status: "online" | "offline",
  ): Promise<Pick<DeviceRecord, "deviceId" | "lastSeenAt">[]>;
};

export function createRepository(pool: Pool): Repository {
  return {
    ingest(deviceId, event, now) {
      return ingest(pool, deviceId, event, now);
    },
    getDevice(deviceId) {
      return getDevice(pool, deviceId);
    },
    listDevicesByLastSeen(now, offlineAfterMs, status) {
      return listDevicesByLastSeen(pool, now, offlineAfterMs, status);
    },
  };
}

async function ingest(
  pool: Pool,
  deviceId: string,
  event: NewEvent,
  now: Date,
): Promise<IngestResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query<EventRow>(
      `INSERT INTO events (
         device_id, event_id, type, occurred_at, payload, received_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (device_id, event_id) DO NOTHING
       RETURNING id, device_id, event_id, type, occurred_at, payload, received_at`,
      [
        deviceId,
        event.event_id,
        event.type,
        event.occurred_at,
        JSON.stringify(event.payload),
        now,
      ],
    );

    if ((inserted.rowCount ?? 0) === 0) {
      const existing = await client.query<EventRow>(
        `SELECT id, device_id, event_id, type, occurred_at, payload, received_at
         FROM events
         WHERE device_id = $1 AND event_id = $2`,
        [deviceId, event.event_id],
      );
      await client.query("COMMIT");
      return { created: false, event: toStoredEvent(existing.rows[0]) };
    }

    await client.query(
      `INSERT INTO device_state (
         device_id, last_seen_at, arm_state, arm_mode, open_sensors
       )
       VALUES ($1, $2, 'disarmed', NULL, '{}')
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, now],
    );

    const locked = await client.query<DeviceRow>(
      `SELECT device_id, last_seen_at, arm_state, arm_mode, open_sensors
       FROM device_state
       WHERE device_id = $1
       FOR UPDATE`,
      [deviceId],
    );

    const current = toDeviceState(locked.rows[0]);
    const next = applyEvent(current, event, now);
    await updateDeviceState(client, next);

    await client.query("COMMIT");
    return { created: true, event: toStoredEvent(inserted.rows[0]) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getDevice(
  pool: Pool,
  deviceId: string,
): Promise<DeviceRecord | null> {
  const result = await pool.query<DeviceRow>(
    `SELECT device_id, last_seen_at, arm_state, arm_mode, open_sensors
     FROM device_state
     WHERE device_id = $1`,
    [deviceId],
  );
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return toDeviceState(result.rows[0]);
}

async function listDevicesByLastSeen(
  pool: Pool,
  now: Date,
  offlineAfterMs: number,
  status: "online" | "offline",
): Promise<Pick<DeviceRecord, "deviceId" | "lastSeenAt">[]> {
  const cutoff = new Date(now.getTime() - offlineAfterMs);
  const result = await pool.query<Pick<DeviceRow, "device_id" | "last_seen_at">>(
    status === "offline"
      ? `SELECT device_id, last_seen_at
         FROM device_state
         WHERE last_seen_at < $1
         ORDER BY last_seen_at ASC, device_id ASC`
      : `SELECT device_id, last_seen_at
         FROM device_state
         WHERE last_seen_at >= $1
         ORDER BY last_seen_at ASC, device_id ASC`,
    [cutoff],
  );

  return result.rows.map((row) => ({
    deviceId: row.device_id,
    lastSeenAt: row.last_seen_at,
  }));
}

async function updateDeviceState(
  client: PoolClient,
  state: DeviceState,
): Promise<void> {
  await client.query(
    `UPDATE device_state
     SET last_seen_at = $2,
         arm_state = $3,
         arm_mode = $4,
         open_sensors = $5
     WHERE device_id = $1`,
    [
      state.deviceId,
      state.lastSeenAt,
      state.armState,
      state.armMode,
      state.openSensors,
    ],
  );
}

function toStoredEvent(row: EventRow): StoredEvent {
  return {
    id: String(row.id),
    device_id: row.device_id,
    event_id: row.event_id,
    type: row.type,
    occurred_at: row.occurred_at,
    received_at: row.received_at,
    payload: row.payload,
  };
}

function toDeviceState(row: DeviceRow): DeviceState {
  return {
    deviceId: row.device_id,
    lastSeenAt: row.last_seen_at,
    armState: row.arm_state,
    armMode: row.arm_mode,
    openSensors: [...row.open_sensors].sort((a, b) => a - b),
  };
}
