export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_id UUID NOT NULL,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (device_id, event_id)
);

CREATE INDEX IF NOT EXISTS events_device_occurred_id_idx
  ON events (device_id, occurred_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS device_state (
  device_id TEXT NOT NULL PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL,
  arm_state TEXT NOT NULL,
  arm_mode TEXT,
  open_sensors INTEGER[] NOT NULL
);

CREATE INDEX IF NOT EXISTS device_state_last_seen_idx
  ON device_state (last_seen_at);
`;
