// .env is the single source of configuration: it overrides variables PM2 or the shell may still hold from an earlier start.
require("dotenv").config({ path: process.env.ENV_FILE || require("path").join(__dirname, "../.env"), override: true, quiet: true });
const argon2 = require("argon2");
const { loadConfig } = require("../src/config");
const { connectDB, disconnectDB } = require("../src/database/connection");
const Organization = require("../src/models/organization.model");
const User = require("../src/models/user.model");
const VaultItem = require("../src/models/vaultItem.model");

async function bootstrap() {
  const config = loadConfig();
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
  if (!email || password.length < 14) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 14 characters");
  await connectDB(config.mongoUri);
  // Single-organization vault: rename the existing organization (if any) instead of creating a second one.
  const organization = await Organization.findOneAndUpdate(
    {},
    { $set: { name: "Hamza", slug: "hamza", primaryDomain: email.split("@")[1], status: "active" } },
    { upsert: true, new: true, sort: { createdAt: 1 } }
  );
  await VaultItem.updateMany(
    { organizationId: organization._id, vaultType: { $exists: false } },
    [{ $set: { vaultType: { $cond: [{ $ne: [{ $ifNull: ["$ownerUserId", null] }, null] }, "personal", "company"] } } }]
  );
  const existing = await User.findOne({ organizationId: organization._id, email });
  if (existing) {
    console.log(`Hamza is ready; super administrator ${email} already exists`);
  } else {
    await User.create({
      organizationId: organization._id, firstName: "Hamza", lastName: "Administrator",
      email, role: "superAdmin", passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    });
    console.log(`Created Hamza and super administrator ${email}`);
  }
  await disconnectDB();
}

bootstrap().catch(async (error) => { console.error(error.message); await disconnectDB(); process.exit(1); });
