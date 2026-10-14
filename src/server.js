// .env is the single source of configuration: it overrides variables PM2 or the shell may still hold from an earlier start.
require("dotenv").config({ path: process.env.ENV_FILE || require("path").join(__dirname, "../.env"), override: true, quiet: true });
const { loadConfig } = require("./config");
const { connectDB, disconnectDB } = require("./database/connection");
const { createApp } = require("./app");

async function start() {
  const config = loadConfig();
  await connectDB(config.mongoUri);
  const server = createApp(config).listen(config.port, config.host, () => {
    console.log(`SEC VAULT listening on ${config.host}:${config.port} (NODE_ENV=${process.env.NODE_ENV || "development"}, APP_ORIGIN=${config.allowedOrigins.join(", ")})`);
  });
  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down`);
    server.close(async () => { await disconnectDB(); process.exit(0); });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => { console.error("Startup failed", error); process.exit(1); });
