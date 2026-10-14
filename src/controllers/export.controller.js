const mongoose = require("mongoose");
const argon2 = require("argon2");
const ExcelJS = require("exceljs");
const User = require("../models/user.model");
const VaultItem = require("../models/vaultItem.model");
const AccessGrant = require("../models/accessGrant.model");
const Platform = require("../models/platform.model");
const UsefulLink = require("../models/usefulLink.model");
const { decryptJson } = require("../security/crypto");
const { audit } = require("../services/audit.service");

const { EJSON } = mongoose.mongo.BSON;

const fileStamp = (date) => date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const httpUrl = (value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol) ? value : null; } catch { return null; }
};

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
  header.alignment = { vertical: "middle" };
  for (const row of rows) {
    const added = sheet.addRow(row);
    added.alignment = { vertical: "top", wrapText: true };
    // Clickable links for http(s) URLs only.
    columns.forEach((column, index) => {
      if (!column.link) return;
      const url = httpUrl(row[column.key]);
      if (url) added.getCell(index + 1).value = { text: url, hyperlink: url };
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

// Readable spreadsheet of every password the requesting user may reveal. Requires re-entering the account password.
exports.exportExcel = async (req, res, next) => {
  try {
    const account = await User.findById(req.user._id).select("+passwordHash");
    if (!(await argon2.verify(account.passwordHash, String(req.body.password || "")))) {
      await audit(req, { action: "vault.exported_excel", result: "failure", metadata: { reason: "bad_password" } });
      return res.status(401).json({ success: false, error: "Incorrect password" });
    }

    const orgId = req.user.organizationId;
    const revealGrants = await AccessGrant.find({
      organizationId: orgId, userId: req.user._id, permissions: "reveal",
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).distinct("vaultItemId");
    const items = await VaultItem.find({
      organizationId: orgId, status: "active",
      $or: [
        { ownerUserId: req.user._id },
        { vaultType: "company" },
        { vaultType: { $exists: false }, ownerUserId: null },
        { _id: { $in: revealGrants } },
      ],
    }).select("+encryptedPayload")
      .populate("platformId", "name category websiteUrl loginUrl")
      .populate("ownerUserId", "firstName lastName email")
      .sort({ name: 1 });
    const masterKey = req.app.locals.config.masterKey;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SEC VAULT";
    workbook.created = new Date();
    addSheet(workbook, "Passwords", [
      { header: "Name", key: "name", width: 26 },
      { header: "Platform", key: "platform", width: 20 },
      { header: "Category", key: "category", width: 14 },
      { header: "Login / username", key: "username", width: 30 },
      { header: "Password", key: "password", width: 28 },
      { header: "Login link", key: "loginUrl", width: 40, link: true },
      { header: "Website", key: "websiteUrl", width: 34, link: true },
      { header: "TOTP secret", key: "totpSecret", width: 26 },
      { header: "Recovery codes", key: "recoveryCodes", width: 26 },
      { header: "Notes", key: "notes", width: 40 },
      { header: "Vault type", key: "vaultType", width: 12 },
      { header: "Owner", key: "owner", width: 24 },
      { header: "Password changed", key: "passwordChangedAt", width: 20 },
    ], items.map((item) => {
      let secret = {};
      try { secret = decryptJson(item.encryptedPayload, masterKey); } catch { secret = { notes: "[could not decrypt with the current VAULT_MASTER_KEY]" }; }
      const platform = item.platformId || {};
      const owner = item.ownerUserId;
      return {
        name: item.name,
        platform: platform.name || "",
        category: platform.category || "",
        username: item.username || "",
        password: secret.password || "",
        loginUrl: platform.loginUrl || "",
        websiteUrl: platform.websiteUrl || "",
        totpSecret: secret.totpSecret || "",
        recoveryCodes: (Array.isArray(secret.recoveryCodes) ? secret.recoveryCodes : [secret.recoveryCodes].filter(Boolean)).join("\n"),
        notes: secret.notes || "",
        vaultType: item.vaultType || (item.ownerUserId ? "personal" : "company"),
        owner: owner ? `${owner.firstName} ${owner.lastName} <${owner.email}>` : "Company",
        passwordChangedAt: item.passwordChangedAt || null,
      };
    }));

    const platforms = await Platform.find({ organizationId: orgId, status: "active" }).sort({ name: 1 });
    addSheet(workbook, "Platforms", [
      { header: "Name", key: "name", width: 26 },
      { header: "Category", key: "category", width: 16 },
      { header: "Login link", key: "loginUrl", width: 44, link: true },
      { header: "Website", key: "websiteUrl", width: 40, link: true },
    ], platforms.map((p) => ({ name: p.name, category: p.category || "", loginUrl: p.loginUrl || "", websiteUrl: p.websiteUrl || "" })));

    const links = await UsefulLink.find({ organizationId: orgId, status: "active" }).sort({ category: 1, url: 1 });
    addSheet(workbook, "Useful links", [
      { header: "Category", key: "category", width: 22 },
      { header: "Link", key: "url", width: 60, link: true },
    ], links.map((l) => ({ category: l.category, url: l.url })));

    const buffer = await workbook.xlsx.writeBuffer();
    await audit(req, { action: "vault.exported_excel", result: "success", metadata: { passwords: items.length, itemIds: items.map((i) => i._id) } });
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sec-vault-passwords-${fileStamp(new Date())}.xlsx"`,
      "Cache-Control": "no-store",
    }).send(Buffer.from(buffer));
  } catch (error) { next(error); }
};

// Full database export: every collection, documents exactly as stored (vault secrets stay encrypted).
// Extended JSON keeps ObjectId and Date types, so the file can be re-imported without loss.
exports.exportDatabase = async (req, res, next) => {
  try {
    const db = mongoose.connection.db;
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("system."))
      .sort();
    const data = {};
    const counts = {};
    for (const name of collections) {
      data[name] = await db.collection(name).find({}).toArray();
      counts[name] = data[name].length;
    }

    const exportedAt = new Date();
    const body = EJSON.stringify({
      format: "mongodb-extended-json",
      database: db.databaseName,
      exportedAt,
      exportedBy: req.user.email,
      counts,
      collections: data,
    }, null, 2, { relaxed: true });

    const stamp = exportedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    await audit(req, { action: "database.exported", result: "success", metadata: { counts } });
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${db.databaseName}-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    }).send(body);
  } catch (error) { next(error); }
};
