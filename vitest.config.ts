import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/db-url.js";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DEVICE_TOKEN: "test-token",
      OFFLINE_THRESHOLD_SECONDS: "300",
      PORT: "3000",
    },
  },
});
