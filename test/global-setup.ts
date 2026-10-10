import pg from "pg";
import { TEST_DATABASE_URL } from "./db-url.js";

export async function setup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if ((exists.rowCount ?? 0) === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}
