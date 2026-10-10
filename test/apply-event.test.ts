import { describe, expect, it } from "vitest";
import { applyEvent, initialDeviceState } from "../src/domain/device-state.js";
import type { NewEvent } from "../src/domain/events.js";

const now = new Date("2026-09-29T14:00:00Z");

describe("applyEvent", () => {
  it("arms and disarms, clearing arm_mode on disarm", () => {
    let state = initialDeviceState("panel", now);
    state = applyEvent(
      state,
      {
        event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        type: "armed",
        occurred_at: now,
        payload: { mode: "away", user_id: 3 },
      },
      now,
    );
    expect(state.armState).toBe("armed");
    expect(state.armMode).toBe("away");

    state = applyEvent(
      state,
      {
        event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        type: "disarmed",
        occurred_at: now,
        payload: { user_id: 3 },
      },
      now,
    );
    expect(state.armState).toBe("disarmed");
    expect(state.armMode).toBeNull();
  });

  it("tracks open sensors in ascending order without duplicates", () => {
    let state = initialDeviceState("panel", now);
    for (const [event_id, sensor_id] of [
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", 7],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", 4],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", 4],
    ] as const) {
      state = applyEvent(
        state,
        {
          event_id,
          type: "sensor_opened",
          occurred_at: now,
          payload: { sensor_id },
        },
        now,
      );
    }
    expect(state.openSensors).toEqual([4, 7]);
  });

  it("leaves state unchanged for sensor_closed on a sensor that was never opened", () => {
    const state = applyEvent(
      initialDeviceState("panel", now),
      {
        event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        type: "sensor_closed",
        occurred_at: now,
        payload: { sensor_id: 4 },
      } satisfies NewEvent,
      now,
    );
    expect(state.openSensors).toEqual([]);
    expect(state.armState).toBe("disarmed");
    expect(state.lastSeenAt).toEqual(now);
  });

  it("heartbeat only updates last_seen_at", () => {
    const later = new Date("2026-09-29T14:01:00Z");
    let state = initialDeviceState("panel", now);
    state = applyEvent(
      state,
      {
        event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        type: "armed",
        occurred_at: now,
        payload: { mode: "stay", user_id: 1 },
      },
      now,
    );
    state = applyEvent(
      state,
      {
        event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        type: "heartbeat",
        occurred_at: later,
        payload: { battery_pct: 87, rssi_dbm: -71 },
      },
      later,
    );
    expect(state.lastSeenAt).toEqual(later);
    expect(state.armState).toBe("armed");
    expect(state.armMode).toBe("stay");
  });
});
