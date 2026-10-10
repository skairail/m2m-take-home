import { afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../src/db/index.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://ingest:ingest@127.0.0.1:5433/ingest",
});

await migrate(pool);

afterAll(async () => {
  await pool.end();
});
