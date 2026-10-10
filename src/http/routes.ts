import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import type { Repository } from "../db/repository.js";
import {
  deviceStatus,
  parseDeviceId,
  parseEventEnvelope,
  type NewEvent,
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
    if (!result.created && duplicateDiffers(parsed.value, result.event)) {
      request.log.warn(
        {
          device_id: deviceId.value,
          event_id: parsed.value.event_id,
        },
        "duplicate event_id with different payload; returning stored event",
      );
    }
    return reply
      .status(result.created ? 201 : 200)
      .send(toPublicEvent(result.event));
  });

  app.get("/devices/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deviceId = parseDeviceId(id);
    if (!deviceId.ok) {
      return sendError(reply, 400, deviceId.message);
    }

    const query = request.query as {
      since?: string;
      limit?: string;
      after_id?: string;
    };

    const since = parseSince(query.since);
    if (!since.ok) {
      return sendError(reply, 400, since.message);
    }

    const limit = parseLimit(query.limit);
    if (!limit.ok) {
      return sendError(reply, 400, limit.message);
    }

    const afterId = parseAfterId(query.after_id);
    if (!afterId.ok) {
      return sendError(reply, 400, afterId.message);
    }

    if (afterId.value !== null && since.value === null) {
      return sendError(reply, 400, "after_id requires since");
    }

    const page = await deps.repo.listDeviceEvents(deviceId.value, {
      since: since.value,
      afterId: afterId.value,
      limit: limit.value,
    });
    if (!page) {
      return sendError(reply, 404, "device not found");
    }

    const last = page.events[page.events.length - 1];
    return reply.status(200).send({
      events: page.events.map(toPublicEvent),
      next:
        page.cursor && last
          ? historyNextUrl(
              request.url,
              request.protocol,
              request.hostname,
              formatUtc(page.cursor.occurredAt),
              page.cursor.id,
              limit.value,
            )
          : null,
    });
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

function duplicateDiffers(incoming: NewEvent, stored: StoredEvent): boolean {
  if (incoming.type !== stored.type) {
    return true;
  }
  if (incoming.occurred_at.getTime() !== stored.occurred_at.getTime()) {
    return true;
  }
  return JSON.stringify(incoming.payload) !== JSON.stringify(stored.payload);
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

function parseSince(
  raw: string | undefined,
): { ok: true; value: Date | null } | { ok: false; message: string } {
  if (raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return { ok: false, message: "since must be an ISO 8601 timestamp" };
  }
  return { ok: true, value: new Date(ms) };
}

function parseLimit(
  raw: string | undefined,
): { ok: true; value: number } | { ok: false; message: string } {
  if (raw === undefined || raw === "") {
    return { ok: true, value: 50 };
  }
  if (!/^[0-9]+$/.test(raw)) {
    return {
      ok: false,
      message: "limit must be an integer between 1 and 500",
    };
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    return {
      ok: false,
      message: "limit must be an integer between 1 and 500",
    };
  }
  return { ok: true, value };
}

function parseAfterId(
  raw: string | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    return { ok: false, message: "after_id must be a positive integer" };
  }
  return { ok: true, value: raw };
}

function historyNextUrl(
  requestUrl: string,
  protocol: string,
  hostname: string,
  since: string,
  afterId: string,
  limit: number,
): string {
  const url = new URL(requestUrl, `${protocol}://${hostname}`);
  url.search = "";
  url.searchParams.set("since", since);
  url.searchParams.set("after_id", afterId);
  url.searchParams.set("limit", String(limit));
  return `${url.pathname}${url.search}`;
}
