import pg from "pg";
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pg;

const MIGRATION_LOCK_ID = 7_340_001;

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  // Without a listener, an idle client dropped by the server crashes the process.
  pool.on("error", (err) => {
    console.error("postgres idle client error", err);
  });
  return pool;
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Concurrent CREATE ... IF NOT EXISTS can still fail on catalog unique indexes.
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA_SQL);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export {
  createRepository,
  type IngestResult,
  type Repository,
} from "./repository.js";
