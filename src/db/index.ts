import pg from "pg";
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pg;

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export {
  createRepository,
  type IngestResult,
  type Repository,
} from "./repository.js";
