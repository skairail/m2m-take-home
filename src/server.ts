import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db/index.js";
import { buildApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await migrate(pool);

  const app = await buildApp({
    config,
    pool,
    clock: systemClock,
    logger: true,
  });

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
