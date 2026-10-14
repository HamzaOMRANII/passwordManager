const mongoose = require("mongoose");

const accessGrantSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  vaultItemId: { type: mongoose.Schema.Types.ObjectId, ref: "VaultItem", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  permissions: [{ type: String, enum: ["view", "reveal", "edit", "manageAccess"] }],
  expiresAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

accessGrantSchema.index({ organizationId: 1, vaultItemId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model("AccessGrant", accessGrantSchema);
