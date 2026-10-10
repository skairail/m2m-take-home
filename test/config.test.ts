import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  DEVICE_TOKEN: "secret",
  DATABASE_URL: "postgres://ingest:ingest@127.0.0.1:5433/ingest",
  OFFLINE_THRESHOLD_SECONDS: "300",
  PORT: "3000",
};

describe("loadConfig", () => {
  it("reads env and applies defaults", () => {
    expect(
      loadConfig({
        DEVICE_TOKEN: "secret",
        DATABASE_URL: "postgres://ingest:ingest@127.0.0.1:5433/ingest",
      }),
    ).toEqual({
      deviceToken: "secret",
      databaseUrl: "postgres://ingest:ingest@127.0.0.1:5433/ingest",
      offlineThresholdSeconds: 300,
      port: 3000,
    });
  });

  it("rejects missing DEVICE_TOKEN", () => {
    expect(() =>
      loadConfig({ ...validEnv, DEVICE_TOKEN: undefined }),
    ).toThrow("DEVICE_TOKEN is required");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadConfig({ ...validEnv, DATABASE_URL: undefined }),
    ).toThrow("DATABASE_URL is required");
  });

  it("rejects invalid OFFLINE_THRESHOLD_SECONDS", () => {
    expect(() =>
      loadConfig({ ...validEnv, OFFLINE_THRESHOLD_SECONDS: "0" }),
    ).toThrow("OFFLINE_THRESHOLD_SECONDS must be a positive integer");
  });

  it("rejects invalid PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrow(
      "PORT must be an integer between 0 and 65535",
    );
  });
});
