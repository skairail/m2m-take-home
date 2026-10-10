import { afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../src/db/index.js";
import { TEST_DATABASE_URL } from "./db-url.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: TEST_DATABASE_URL });

await migrate(pool);

afterAll(async () => {
  await pool.end();
});
