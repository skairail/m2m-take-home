import type { NewEvent } from "./events.js";

export type ArmState = "armed" | "disarmed";
export type ArmMode = "away" | "stay";
export type DeviceOnlineStatus = "online" | "offline";

export type DeviceState = {
  deviceId: string;
  lastSeenAt: Date;
  armState: ArmState;
  armMode: ArmMode | null;
  openSensors: number[];
};

export function initialDeviceState(deviceId: string, now: Date): DeviceState {
  return {
    deviceId,
    lastSeenAt: now,
    armState: "disarmed",
    armMode: null,
    openSensors: [],
  };
}

export function applyEvent(
  state: DeviceState,
  event: NewEvent,
  now: Date,
): DeviceState {
  const next: DeviceState = {
    ...state,
    // Requests can commit out of order, so `now` may be older than the stored value.
    lastSeenAt: now > state.lastSeenAt ? now : state.lastSeenAt,
    openSensors: [...state.openSensors],
  };

  switch (event.type) {
    case "armed":
      next.armState = "armed";
      next.armMode = event.payload.mode;
      break;
    case "disarmed":
      next.armState = "disarmed";
      next.armMode = null;
      break;
    case "sensor_opened": {
      const sensorId = event.payload.sensor_id;
      if (!next.openSensors.includes(sensorId)) {
        next.openSensors.push(sensorId);
        next.openSensors.sort((a, b) => a - b);
      }
      break;
    }
    case "sensor_closed":
      next.openSensors = next.openSensors.filter(
        (id) => id !== event.payload.sensor_id,
      );
      break;
    case "heartbeat":
      break;
  }

  return next;
}

export function deviceStatus(
  lastSeenAt: Date,
  now: Date,
  offlineAfterMs: number,
): DeviceOnlineStatus {
  // Derived at read time so a silent device becomes offline without a write.
  return now.getTime() - lastSeenAt.getTime() > offlineAfterMs
    ? "offline"
    : "online";
}
