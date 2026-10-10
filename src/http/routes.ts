import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import type { Repository } from "../db/repository.js";
import {
  deviceStatus,
  parseDeviceId,
  parseEventEnvelope,
  type StoredEvent,
} from "../domain/index.js";
import { formatUtc, sendError } from "./errors.js";

type Deps = {
  repo: Repository;
  clock: Clock;
  config: Config;
};

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  app.post("/devices/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deviceId = parseDeviceId(id);
    if (!deviceId.ok) {
      return sendError(reply, 400, deviceId.message);
    }

    const parsed = parseEventEnvelope(request.body);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.message);
    }

    const result = await deps.repo.ingest(
      deviceId.value,
      parsed.value,
      deps.clock.now(),
    );
    return reply
      .status(result.created ? 201 : 200)
      .send(toPublicEvent(result.event));
  });

  app.get("/devices/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deviceId = parseDeviceId(id);
    if (!deviceId.ok) {
      return sendError(reply, 400, deviceId.message);
    }

    const device = await deps.repo.getDevice(deviceId.value);
    if (!device) {
      return sendError(reply, 404, "device not found");
    }

    const offlineAfterMs = deps.config.offlineThresholdSeconds * 1000;
    return reply.status(200).send({
      device_id: device.deviceId,
      status: deviceStatus(device.lastSeenAt, deps.clock.now(), offlineAfterMs),
      last_seen_at: formatUtc(device.lastSeenAt),
      arm_state: device.armState,
      arm_mode: device.armMode,
      open_sensors: device.openSensors,
    });
  });

  app.get("/devices", async (request, reply) => {
    const query = request.query as { status?: string };
    if (query.status !== "online" && query.status !== "offline") {
      return sendError(reply, 400, "status must be online or offline");
    }

    const offlineAfterMs = deps.config.offlineThresholdSeconds * 1000;
    const devices = await deps.repo.listDevicesByLastSeen(
      deps.clock.now(),
      offlineAfterMs,
      query.status,
    );

    return reply.status(200).send({
      devices: devices.map((device) => ({
        device_id: device.deviceId,
        status: query.status,
        last_seen_at: formatUtc(device.lastSeenAt),
      })),
    });
  });
}

function toPublicEvent(event: StoredEvent) {
  return {
    device_id: event.device_id,
    event_id: event.event_id,
    type: event.type,
    occurred_at: formatUtc(event.occurred_at),
    payload: event.payload,
  };
}
