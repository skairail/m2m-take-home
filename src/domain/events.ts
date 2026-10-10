export const EVENT_TYPES = [
  "armed",
  "disarmed",
  "sensor_opened",
  "sensor_closed",
  "heartbeat",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type ArmedPayload = { mode: "away" | "stay"; user_id: number };
export type DisarmedPayload = { user_id: number };
export type SensorPayload = { sensor_id: number };
export type HeartbeatPayload = { battery_pct: number; rssi_dbm: number };

export type EventPayload =
  | ArmedPayload
  | DisarmedPayload
  | SensorPayload
  | HeartbeatPayload;

export type NewEvent =
  | {
      event_id: string;
      type: "armed";
      occurred_at: Date;
      payload: ArmedPayload;
    }
  | {
      event_id: string;
      type: "disarmed";
      occurred_at: Date;
      payload: DisarmedPayload;
    }
  | {
      event_id: string;
      type: "sensor_opened";
      occurred_at: Date;
      payload: SensorPayload;
    }
  | {
      event_id: string;
      type: "sensor_closed";
      occurred_at: Date;
      payload: SensorPayload;
    }
  | {
      event_id: string;
      type: "heartbeat";
      occurred_at: Date;
      payload: HeartbeatPayload;
    };

export type StoredEvent = {
  id: string;
  device_id: string;
  event_id: string;
  type: EventType;
  occurred_at: Date;
  received_at: Date;
  payload: EventPayload;
};
