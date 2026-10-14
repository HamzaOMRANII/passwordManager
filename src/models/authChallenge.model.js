const mongoose = require("mongoose");

const authChallengeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // "login" (default; older documents have no purpose) or "email_change" (code sent to pendingEmail).
  purpose: { type: String, enum: ["login", "email_change"], default: "login" },
  pendingEmail: { type: String, lowercase: true, trim: true },
  code: { type: String, select: false },
  codeDigest: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attemptsRemaining: { type: Number, required: true, default: 5 },
  sendCount: { type: Number, required: true, default: 1 },
  lastSentAt: { type: Date, required: true, default: Date.now },
  usedAt: { type: Date, default: null },
  requestedIp: String,
}, { timestamps: true });

module.exports = mongoose.model("AuthChallenge", authChallengeSchema);
