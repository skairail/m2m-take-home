export type Config = {
  deviceToken: string;
  offlineThresholdSeconds: number;
  databaseUrl: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const deviceToken = required(env.DEVICE_TOKEN, "DEVICE_TOKEN");
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");

  return {
    deviceToken,
    databaseUrl,
    offlineThresholdSeconds: parsePositiveInt(
      env.OFFLINE_THRESHOLD_SECONDS ?? "300",
      "OFFLINE_THRESHOLD_SECONDS",
    ),
    port: parsePort(env.PORT ?? "3000"),
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parsePort(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  return value;
}
