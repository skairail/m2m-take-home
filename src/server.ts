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

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    let code = 0;
    try {
      await app.close();
      await pool.end();
    } catch (err) {
      console.error(err);
      code = 1;
    }
    process.exit(code);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
