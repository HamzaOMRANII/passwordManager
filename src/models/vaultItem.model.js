const mongoose = require("mongoose");

const encryptedSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
  algorithm: { type: String, enum: ["aes-256-gcm"], default: "aes-256-gcm" },
  keyVersion: { type: Number, default: 1 },
}, { _id: false });

const vaultItemSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  platformId: { type: mongoose.Schema.Types.ObjectId, ref: "Platform", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  username: { type: String, trim: true, maxlength: 254 },
  encryptedPayload: { type: encryptedSchema, required: true, select: false },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  vaultType: { type: String, enum: ["company", "personal"], default: "personal", index: true },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  passwordChangedAt: Date,
  rotationDueAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

vaultItemSchema.index({ organizationId: 1, platformId: 1 });
module.exports = mongoose.model("VaultItem", vaultItemSchema);
