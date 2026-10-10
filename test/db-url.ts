// Separate database: tests TRUNCATE tables after each case.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://ingest:ingest@127.0.0.1:5433/ingest_test";
