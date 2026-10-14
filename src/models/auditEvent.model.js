const mongoose = require("mongoose");

const auditEventSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true, index: true },
  resourceType: String,
  resourceId: mongoose.Schema.Types.ObjectId,
  result: { type: String, enum: ["success", "failure"], required: true },
  ipAddress: String,
  userAgent: String,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model("AuditEvent", auditEventSchema);
