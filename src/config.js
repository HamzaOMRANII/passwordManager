const required = ["MONGO_URI", "JWT_SECRET", "VAULT_MASTER_KEY"];

function loadConfig() {
  const production = process.env.NODE_ENV === "production";
  const smtpNames = production
    ? ["EMAIL_FROM", "EMAIL_PASSWORD", "EMAIL_HOST", "EMAIL_PORT"]
    : ["SMTP_DEV_FROM", "SMTP_DEV_PASSWORD", "SMTP_DEV_HOST", "SMTP_DEV_PORT"];
  const missing = [...required, ...smtpNames].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const masterKey = Buffer.from(process.env.VAULT_MASTER_KEY, "base64");
  if (masterKey.length !== 32) throw new Error("VAULT_MASTER_KEY must decode to exactly 32 bytes");
  if (process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

  // APP_ORIGIN may list several origins separated by commas; each is normalized
  // (scheme + host + port, no path or trailing slash) so "http://x:11000/" matches "http://x:11000".
  const allowedOrigins = String(process.env.APP_ORIGIN || "http://localhost:11000")
    .split(",").map((value) => value.trim()).filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { throw new Error(`APP_ORIGIN contains an invalid URL: "${value}"`); }
    });
  const appOrigin = allowedOrigins[0];
  return {
    allowedOrigins,
    // Loopback by default so only the reverse proxy (Nginx) can reach Express.
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 11000),
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    masterKey,
    production,
    appOrigin,
    // HTTPS-only cookies, HSTS and upgrade-insecure-requests apply only when the public origin is HTTPS.
    https: appOrigin.startsWith("https://"),
    itToolsOrigin: process.env.IT_TOOLS_ORIGIN || "https://it-tools.tech",
    smtp: {
      from: production ? process.env.EMAIL_FROM : process.env.SMTP_DEV_FROM,
      password: production ? process.env.EMAIL_PASSWORD : process.env.SMTP_DEV_PASSWORD,
      host: production ? process.env.EMAIL_HOST : process.env.SMTP_DEV_HOST,
      port: Number(production ? process.env.EMAIL_PORT : process.env.SMTP_DEV_PORT),
      secure: Number(production ? process.env.EMAIL_PORT : process.env.SMTP_DEV_PORT) === 465,
    },
  };
}

module.exports = { loadConfig };
