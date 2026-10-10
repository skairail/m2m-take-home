import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://ingest:ingest@127.0.0.1:5433/ingest",
      DEVICE_TOKEN: "test-token",
      OFFLINE_THRESHOLD_SECONDS: "300",
      PORT: "3000",
    },
  },
});
