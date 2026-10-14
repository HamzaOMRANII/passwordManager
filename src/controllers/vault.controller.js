const mongoose = require("mongoose");
const VaultItem = require("../models/vaultItem.model");
const AccessGrant = require("../models/accessGrant.model");
const Platform = require("../models/platform.model");
const User = require("../models/user.model");
const { encryptJson, decryptJson } = require("../security/crypto");
const { audit } = require("../services/audit.service");

const isAdmin = (user) => ["admin", "superAdmin"].includes(user.role);
const isOwner = (user, item) => String(item.ownerUserId || "") === String(user._id);
const isCompanyItem = (item) => item.vaultType === "company" || (!item.vaultType && !item.ownerUserId);
const activeGrant = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

async function authorizedItem(user, id, permission, includeSecret = false) {
  if (!mongoose.isValidObjectId(id)) return null;
  const query = VaultItem.findOne({ _id: id, organizationId: user.organizationId, status: "active" });
  if (includeSecret) query.select("+encryptedPayload");
  const item = await query.populate("platformId", "name websiteUrl loginUrl");
  if (!item) return null;
  if (isOwner(user, item) || (isAdmin(user) && isCompanyItem(item))) return item;
  const grant = await AccessGrant.findOne({
    organizationId: user.organizationId,
    vaultItemId: item._id,
    userId: user._id,
    permissions: permission,
    ...activeGrant(),
  });
  return grant ? item : null;
}

async function grantedItemIds(user, permission) {
  return AccessGrant.find({
    organizationId: user.organizationId,
    userId: user._id,
    permissions: permission,
    ...activeGrant(),
  }).distinct("vaultItemId");
}

function accessibleFilter(user, grantIds) {
  const choices = [{ ownerUserId: user._id }, { _id: { $in: grantIds } }];
  if (isAdmin(user)) {
    choices.push({ vaultType: "company" }, { vaultType: { $exists: false }, ownerUserId: null });
  }
  return { organizationId: user.organizationId, status: "active", $or: choices };
}

exports.list = async (req, res, next) => {
  try {
    const userGrants = await AccessGrant.find({
      organizationId: req.user.organizationId,
      userId: req.user._id,
      ...activeGrant(),
    }).select("vaultItemId permissions");
    const visibleGrantIds = userGrants.filter((grant) => grant.permissions.includes("view")).map((grant) => grant.vaultItemId);
    const items = await VaultItem.find(accessibleFilter(req.user, visibleGrantIds))
      .populate("platformId", "name websiteUrl loginUrl")
      .sort({ name: 1 });
    const sharedCounts = await AccessGrant.aggregate([
      { $match: { organizationId: req.user.organizationId, vaultItemId: { $in: items.map((item) => item._id) }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] } },
      { $group: { _id: "$vaultItemId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(sharedCounts.map((entry) => [String(entry._id), entry.count]));
    const permissionMap = new Map(userGrants.map((grant) => [String(grant.vaultItemId), grant.permissions]));
    res.json({ success: true, items: items.map((item) => {
      const owner = isOwner(req.user, item);
      const companyAdmin = isAdmin(req.user) && isCompanyItem(item);
      const permissions = permissionMap.get(String(item._id)) || [];
      return {
        ...item.toJSON(),
        sharedWithCount: countMap.get(String(item._id)) || 0,
        canReveal: owner || companyAdmin || permissions.includes("reveal"),
        canEdit: owner || companyAdmin || permissions.includes("edit"),
        canManageAccess: owner || companyAdmin || permissions.includes("manageAccess"),
      };
    }) });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const { platformId, name, username, password, totpSecret, recoveryCodes, notes } = req.body;
    if (!platformId || !name || !password) return res.status(400).json({ success: false, error: "Platform, name and password are required" });
    const platform = await Platform.exists({ _id: platformId, organizationId: req.user.organizationId, status: "active" });
    if (!platform) return res.status(400).json({ success: false, error: "Platform does not belong to this organization" });

    const vaultType = isAdmin(req.user) && req.body.vaultType === "company" ? "company" : "personal";
    const item = await VaultItem.create({
      organizationId: req.user.organizationId,
      platformId,
      name,
      username,
      vaultType,
      ownerUserId: vaultType === "personal" ? req.user._id : null,
      encryptedPayload: encryptJson({ password, totpSecret, recoveryCodes, notes }, req.app.locals.config.masterKey),
      passwordChangedAt: new Date(),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await audit(req, { action: "vault.created", result: "success", resourceType: "vaultItem", resourceId: item._id, metadata: { vaultType } });
    res.status(201).json({ success: true, item });
  } catch (error) { next(error); }
};

exports.reveal = async (req, res, next) => {
  try {
    const item = await authorizedItem(req.user, req.params.id, "reveal", true);
    if (!item) {
      await audit(req, { action: "vault.revealed", result: "failure", resourceType: "vaultItem" });
      return res.status(404).json({ success: false, error: "Vault item not found or access denied" });
    }
    const secret = decryptJson(item.encryptedPayload, req.app.locals.config.masterKey);
    const safeItem = item.toJSON();
    delete safeItem.encryptedPayload;
    await audit(req, { action: "vault.revealed", result: "success", resourceType: "vaultItem", resourceId: item._id });
    res.set("Cache-Control", "no-store").json({ success: true, item: { ...safeItem, secret } });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const item = await authorizedItem(req.user, req.params.id, "edit", true);
    if (!item) return res.status(404).json({ success: false, error: "Vault item not found or access denied" });
    if (req.body.platformId) {
      const platform = await Platform.exists({ _id: req.body.platformId, organizationId: req.user.organizationId, status: "active" });
      if (!platform) return res.status(400).json({ success: false, error: "Platform does not belong to this organization" });
      item.platformId = req.body.platformId;
    }
    const secret = decryptJson(item.encryptedPayload, req.app.locals.config.masterKey);
    for (const field of ["password", "totpSecret", "recoveryCodes", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) secret[field] = req.body[field];
    }
    if (req.body.name !== undefined) item.name = req.body.name;
    if (req.body.username !== undefined) item.username = req.body.username;
    if (req.body.password) item.passwordChangedAt = new Date();
    item.encryptedPayload = encryptJson(secret, req.app.locals.config.masterKey);
    item.updatedBy = req.user._id;
    await item.save();
    const safeItem = item.toJSON();
    delete safeItem.encryptedPayload;
    await audit(req, { action: "vault.updated", result: "success", resourceType: "vaultItem", resourceId: item._id });
    res.json({ success: true, item: safeItem });
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: "Vault item not found" });
    const item = await VaultItem.findOne({ _id: req.params.id, organizationId: req.user.organizationId, status: "active" });
    if (!item || (!isOwner(req.user, item) && !(isAdmin(req.user) && isCompanyItem(item)))) {
      return res.status(403).json({ success: false, error: "Only the owner can delete this password" });
    }
    item.status = "archived";
    item.updatedBy = req.user._id;
    await item.save();
    await AccessGrant.deleteMany({ organizationId: req.user.organizationId, vaultItemId: item._id });
    await audit(req, { action: "vault.archived", result: "success", resourceType: "vaultItem", resourceId: item._id });
    res.json({ success: true });
  } catch (error) { next(error); }
};

exports.accessMatrix = async (req, res, next) => {
  try {
    const managedByGrant = await grantedItemIds(req.user, "manageAccess");
    const items = await VaultItem.find(accessibleFilter(req.user, managedByGrant))
      .populate("platformId", "name")
      .sort({ name: 1 });
    const itemIds = items.map((item) => item._id);
    const [users, grants] = await Promise.all([
      User.find({ organizationId: req.user.organizationId, status: "active" }).select("firstName lastName email role").sort({ firstName: 1 }),
      AccessGrant.find({ organizationId: req.user.organizationId, vaultItemId: { $in: itemIds }, ...activeGrant() }).select("vaultItemId userId permissions expiresAt"),
    ]);
    res.json({ success: true, items, users, grants });
  } catch (error) { next(error); }
};

exports.grant = async (req, res, next) => {
  try {
    const [item, targetUser] = await Promise.all([
      authorizedItem(req.user, req.params.id, "manageAccess"),
      User.exists({ _id: req.body.userId, organizationId: req.user.organizationId, status: "active" }),
    ]);
    if (!item || !targetUser) return res.status(403).json({ success: false, error: "You cannot manage access to this password" });
    if (String(item.ownerUserId || "") === String(req.body.userId)) {
      return res.status(400).json({ success: false, error: "The owner already has full access" });
    }
    const permissions = [...new Set(["view", ...(Array.isArray(req.body.permissions) ? req.body.permissions : [])])];
    const grant = await AccessGrant.findOneAndUpdate(
      { organizationId: req.user.organizationId, vaultItemId: item._id, userId: req.body.userId },
      { permissions, expiresAt: req.body.expiresAt || null, createdBy: req.user._id },
      { upsert: true, new: true, runValidators: true }
    );
    await audit(req, { action: "vault.access_granted", result: "success", resourceType: "vaultItem", resourceId: grant.vaultItemId, metadata: { userId: grant.userId, permissions: grant.permissions } });
    res.json({ success: true, grant });
  } catch (error) { next(error); }
};

exports.revokeGrant = async (req, res, next) => {
  try {
    const item = await authorizedItem(req.user, req.params.id, "manageAccess");
    if (!item) return res.status(403).json({ success: false, error: "You cannot manage access to this password" });
    const grant = await AccessGrant.findOneAndDelete({
      organizationId: req.user.organizationId,
      vaultItemId: item._id,
      userId: req.params.userId,
    });
    if (!grant) return res.status(404).json({ success: false, error: "Access grant not found" });
    await audit(req, { action: "vault.access_revoked", result: "success", resourceType: "vaultItem", resourceId: item._id, metadata: { userId: grant.userId } });
    res.json({ success: true });
  } catch (error) { next(error); }
};
