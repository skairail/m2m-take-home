import { z } from "zod";

export const EVENT_TYPES = [
  "armed",
  "disarmed",
  "sensor_opened",
  "sensor_closed",
  "heartbeat",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const uuidSchema = z
  .string()
  .uuid({ message: "event_id must be a UUID" });

// Explicit offset required: without one, Date.parse uses the host time zone.
export function isoTimestampSchema(field: string) {
  const message = `${field} must be an ISO 8601 timestamp with a time zone`;
  return z
    .string({ message })
    .datetime({ offset: true, message })
    .transform((value) => new Date(value));
}

const occurredAtSchema = isoTimestampSchema("occurred_at");

const armedPayload = z
  .object({
    mode: z.enum(["away", "stay"], {
      message: "payload.mode must be away or stay",
    }),
    user_id: z.number().int({ message: "payload.user_id must be an integer" }),
  })
  .strict();

const disarmedPayload = z
  .object({
    user_id: z.number().int({ message: "payload.user_id must be an integer" }),
  })
  .strict();

const sensorPayload = z
  .object({
    sensor_id: z
      .number()
      .int()
      .min(1)
      .max(64, { message: "payload.sensor_id must be an integer from 1 to 64" }),
  })
  .strict();

const heartbeatPayload = z
  .object({
    battery_pct: z
      .number()
      .int()
      .min(0)
      .max(100, {
        message: "payload.battery_pct must be an integer from 0 to 100",
      }),
    rssi_dbm: z
      .number()
      .int({ message: "payload.rssi_dbm must be an integer" }),
  })
  .strict();

export const eventEnvelopeSchema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        event_id: uuidSchema,
        type: z.literal("armed"),
        occurred_at: occurredAtSchema,
        payload: armedPayload,
      })
      .strict(),
    z
      .object({
        event_id: uuidSchema,
        type: z.literal("disarmed"),
        occurred_at: occurredAtSchema,
        payload: disarmedPayload,
      })
      .strict(),
    z
      .object({
        event_id: uuidSchema,
        type: z.literal("sensor_opened"),
        occurred_at: occurredAtSchema,
        payload: sensorPayload,
      })
      .strict(),
    z
      .object({
        event_id: uuidSchema,
        type: z.literal("sensor_closed"),
        occurred_at: occurredAtSchema,
        payload: sensorPayload,
      })
      .strict(),
    z
      .object({
        event_id: uuidSchema,
        type: z.literal("heartbeat"),
        occurred_at: occurredAtSchema,
        payload: heartbeatPayload,
      })
      .strict(),
  ],
  {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
        return {
          message:
            "type must be one of armed, disarmed, sensor_opened, sensor_closed, heartbeat",
        };
      }
      return { message: ctx.defaultError };
    },
  },
);

export type NewEvent = z.infer<typeof eventEnvelopeSchema>;
export type ArmedPayload = z.infer<typeof armedPayload>;
export type DisarmedPayload = z.infer<typeof disarmedPayload>;
export type SensorPayload = z.infer<typeof sensorPayload>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayload>;
export type EventPayload = NewEvent["payload"];

export type StoredEvent = {
  id: string;
  device_id: string;
  event_id: string;
  type: EventType;
  occurred_at: Date;
  received_at: Date;
  payload: EventPayload;
};

export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, {
    message:
      "device_id must be 1 to 64 letters, digits, hyphens, or underscores",
  });

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseEventEnvelope(body: unknown): ParseResult<NewEvent> {
  const parsed = eventEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "invalid event",
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseDeviceId(id: string): ParseResult<string> {
  const parsed = deviceIdSchema.safeParse(id);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "invalid device_id",
    };
  }
  return { ok: true, value: parsed.data };
}
