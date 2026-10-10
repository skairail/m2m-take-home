# Device event ingest

HTTP service that accepts events from security panels, stores each `(device_id, event_id)` once, and exposes current device state with online/offline computed from a silence threshold.

Stack: Node 22, Fastify, PostgreSQL 16, zod, vitest.

## Run

**Everything in Docker:**

```bash
cp .env.example .env
docker compose up --build
```

API on `http://localhost:3000`, token `dev-shared-token` (from `.env`). Compose refuses to start if `DEVICE_TOKEN` is unset. Migrations run on startup.

**App on the host, Postgres in Docker:**

```bash
cp .env.example .env
docker compose up -d postgres     # published on 127.0.0.1:5433
npm ci
npm run build
npm start                         # reads .env
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEVICE_TOKEN` | required | Shared `X-Device-Token` value |
| `DATABASE_URL` | required | Postgres connection string |
| `OFFLINE_THRESHOLD_SECONDS` | `300` | Silence after which a device is offline |
| `PORT` | `3000` | HTTP port |

## Tests

```bash
docker compose up -d postgres
npm ci
npm run lint
npm run typecheck
npm test
```

Tests run against a separate database, `ingest_test`, on the same server. It is created on first run; override with `TEST_DATABASE_URL`. Tests truncate tables, so they never point at the dev database. Time is controlled with `FakeClock`, so the 5-minute rule is tested without waiting.

CI (`.github/workflows/ci.yml`): lint and typecheck, tests against a Postgres service, then `docker compose up --build` and an authenticated smoke request against the built image.

## API and curl

All endpoints require `X-Device-Token`. Errors are `{"error": true, "message": "..."}`. Check order: `401`, then `400`, then `404`.

```bash
TOKEN=dev-shared-token
BASE=http://localhost:3000
```

**`POST /devices/{id}/events`**: `201` for a new event, `200` with the stored event for a duplicate `event_id`.

```bash
curl -sS -i -X POST "$BASE/devices/panel-0042/events" \
  -H "X-Device-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"event_id":"7c1e9a52-3b0f-4d8e-9a61-2f4b8c0d1e77","type":"armed","occurred_at":"2026-09-29T14:00:00Z","payload":{"mode":"away","user_id":3}}'
```

Other types and payloads:

| `type` | `payload` |
| --- | --- |
| `armed` | `{"mode": "away" \| "stay", "user_id": int}` |
| `disarmed` | `{"user_id": int}` |
| `sensor_opened`, `sensor_closed` | `{"sensor_id": 1..64}` |
| `heartbeat` | `{"battery_pct": 0..100, "rssi_dbm": int}` |

**`GET /devices/{id}`**: current state, `404` if the device never sent an event.

```bash
curl -sS -H "X-Device-Token: $TOKEN" "$BASE/devices/panel-0042"
# {"device_id":"panel-0042","status":"online","last_seen_at":"2026-09-29T14:00:00Z",
#  "arm_state":"armed","arm_mode":"away","open_sensors":[]}
```

**`GET /devices?status=online|offline`**: sorted by `last_seen_at` ascending (longest silent first). `status` is required.

```bash
curl -sS -H "X-Device-Token: $TOKEN" "$BASE/devices?status=offline"
# {"devices":[{"device_id":"panel-0042","status":"offline","last_seen_at":"2026-09-29T14:00:00Z"}]}
```

**`GET /devices/{id}/events?since=&limit=`**: history, oldest first, with a `next` cursor.

```bash
curl -sS -H "X-Device-Token: $TOKEN" \
  "$BASE/devices/panel-0042/events?since=2026-09-29T13:00:00Z&limit=2"
# {"events":[...],"next":"/devices/panel-0042/events?since=2026-09-29T14%3A01%3A00Z&after_id=2&limit=2"}

curl -sS -H "X-Device-Token: $TOKEN" "$BASE/devices/panel-0042/events?since=2026-09-29T14%3A01%3A00Z&after_id=2&limit=2"
```

## Design

**Two tables** (`src/db/schema.ts`):

- `events`: an append-only log of everything received, with columns `id BIGSERIAL`, `device_id`, `event_id UUID`, `type`, `occurred_at`, `payload JSONB` and `received_at`. `UNIQUE (device_id, event_id)` is the idempotency key. An index on `(device_id, occurred_at, id)` serves history.
- `device_state`: one row per device, the derived snapshot (`last_seen_at`, `arm_state`, `arm_mode`, `open_sensors INTEGER[]`). An index on `last_seen_at` serves the online/offline list. Reads never replay the log.

**Computed status.** `status` is not stored. A device is `offline` when `now - last_seen_at > OFFLINE_THRESHOLD_SECONDS`, otherwise `online`. `GET /devices/{id}` computes this in code; `GET /devices` uses the equivalent SQL cutoff (`last_seen_at < now - threshold`). A silent device goes offline without any write or background job.

**One transaction per new event** (`ingest` in `src/db/repository.ts`):

1. `INSERT INTO events ... ON CONFLICT (device_id, event_id) DO NOTHING RETURNING ...`.
2. Empty `RETURNING` means a duplicate: `SELECT` the stored row, `COMMIT`, return `200`. `device_state` is not touched.
3. Otherwise, insert a placeholder `device_state` row if missing (`ON CONFLICT DO NOTHING`), then `SELECT ... FOR UPDATE` it.
4. Apply the event in a pure reducer (`applyEvent`), `UPDATE device_state`, `COMMIT`, return `201`.

Concurrent retries of one `event_id` block on the unique index, and only one of them inserts. Concurrent new events for one device serialize on the row lock, so no update is lost (covered by a test with 20 parallel `sensor_opened`).

**Clock.** All "now" comes from an injected `Clock` (`src/clock.ts`). Production uses `systemClock`; tests use `FakeClock`, which they move manually (for example 14:07:00 is online and 14:07:00.001 is offline). `last_seen_at` and `received_at` are server time, never the device's `occurred_at`.

**Auth.** Shared token in `X-Device-Token`, checked in an `onRequest` hook before body validation. Both values are SHA-256 hashed and compared with `timingSafeEqual`, so the comparison takes the same time regardless of where or whether the tokens differ, and lengths always match.

## Assumptions

- `event_id` must be a UUID. It is unique per device, not globally.
- `device_id` is 1–64 characters of `[A-Za-z0-9_-]`; anything else is `400`.
- Unknown fields in the envelope or payload are `400`.
- `occurred_at` and `since` must be ISO 8601 with an explicit time zone: `Z` as in the spec, or an offset such as `+03:00`, which is normalized to UTC. Timestamps without a zone, impossible dates and out-of-range years are `400` (this is stricter than "any valid timestamp" in my question to the PM). `occurred_at` is stored with millisecond precision and never used for online/offline.
- Exactly at the threshold the device is still `online` (`>`, not `>=`).
- `last_seen_at` is set only by new events, never by duplicates, and never moves backwards even if requests commit out of order.
- Device state is applied in arrival order, not `occurred_at` order. A delayed older event overwrites newer state.
- A new device starts `disarmed` with `arm_mode: null` and no open sensors.
- `sensor_closed` for a sensor that was never opened is stored, and `open_sensors` is unchanged.
- Duplicate `event_id` with a different body: `200` with the original stored event, the new body is ignored, and a warning is logged.
- `GET /devices` without `status` or with an unknown value is `400`.
- History for an unknown device is `404`. A known device with nothing in range returns `{"events": [], "next": null}`.

## Extension: History API

**Why this one.** Every event is already persisted for idempotency, so history adds no new write path or infrastructure, only a read over existing data. It is also the most direct use of the log for support and debugging ("what did this panel send?"). It also exercises the edge cases that matter here: stable ordering, inclusive bounds, and pagination that stays correct while new events arrive.

**Pagination (keyset, not offset):**

- Order is `occurred_at ASC, id ASC`. `id` is the internal arrival sequence and breaks ties between events with the same timestamp.
- `since` is inclusive (`occurred_at >= since`) and must be ISO 8601 with a time zone.
- `limit` defaults to 50, max 500.
- The handler fetches `limit + 1` rows. If the extra row exists, `next` is a relative URL with `since=<last occurred_at>&after_id=<last id>&limit=<limit>`; otherwise `next` is `null`.
- With `after_id`, the condition becomes `occurred_at > since OR (occurred_at = since AND id > after_id)`, which is exclusive of the last returned row and does not skip ties. `after_id` without `since` is `400`.
- Unlike `OFFSET`, an insert with an earlier `occurred_at` does not shift later pages. Trade-off: such an insert is not returned to a client that has already paged past it.

## Where AI was used

I used Claude as a pair-programming assistant. I owned the requirements, the design and the review of everything that was merged.

- **Design (mine):** two tables, status computed at read time, one transaction per new event, keyset pagination, and the assumptions listed above. I used AI to challenge these choices, not to make them.
- **Implementation:** AI drafted boilerplate (project setup, Dockerfile, compose, CI) and first versions of the repository, routes and tests from my specifications. I reviewed and changed every file.
- **Hardening:** I went through concurrency, idempotency, the 5-minute boundary and input validation, using AI as a second reviewer. Each fix has a test, and I checked that the tests fail when the fix is removed.
- **Documentation:** AI helped draft this README and the code comments, which I edited.


## Not done

- No `/health` endpoint, metrics (ingest rate, duplicate rate, latency) or alerts.
- `GET /devices` is not paginated.
- No load test.
- Out-of-order delivery is not handled (state follows arrival order).
- No per-device or per-token rate limiting; a single shared token for all devices.
- `user_id` and `rssi_dbm` have no range limits.
- CI actions are pinned by tag, not SHA. `npm audit` reports dev-only issues in the vitest toolchain (fix requires vitest 5).
- No deploy or CD.

## At 10x scale

- **Partition `events`.** Use `PARTITION BY HASH (device_id)`, so `UNIQUE (device_id, event_id)` stays enforceable: a unique key on a partitioned table must include the partition key. Old data can be archived or TTL'd per partition; raw heartbeats are the bulk and the first candidate.
- **Batch writes.** Use multi-row `INSERT ... ON CONFLICT DO NOTHING` per batch. Apply each device's new events in one `device_state` update per batch instead of one per event. Heartbeats collapse to a single `last_seen_at = GREATEST(...)`.
- **Cache or separate store for `device_state`.** Serve `GET /devices/{id}` from Redis (a hash per device), with Postgres as the source of truth. Alternatively, keep `device_state` in its own database so dashboard reads do not compete with ingest.
- **Index for the offline list.** `last_seen_at` is already indexed, so both filters are range scans. Next steps: a covering index `(last_seen_at, device_id)` for index-only scans, and keyset pagination on the same pair. In Redis, a sorted set keyed by `last_seen_at` answers "offline" with one `ZRANGEBYSCORE`.
- **Queue before the write.** The API validates, authenticates and enqueues to Kafka or SQS FIFO, partitioned by `device_id` to keep per-device order. Consumers write in batches, and idempotency still comes from the unique key. Cost: `POST` returns `202` and can no longer say `201` vs `200` synchronously.
