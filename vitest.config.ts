import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://ingest:ingest@127.0.0.1:5432/ingest",
      DEVICE_TOKEN: "test-token",
      OFFLINE_THRESHOLD_SECONDS: "300",
      PORT: "3000",
    },
  },
});
