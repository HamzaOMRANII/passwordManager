const AuditEvent = require("../models/auditEvent.model");

async function audit(req, event) {
  try {
    await AuditEvent.create({
      organizationId: req.user?.organizationId,
      actorUserId: req.user?._id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      ...event,
    });
  } catch (error) {
    console.error("Audit write failed", error.message);
  }
}

module.exports = { audit };
