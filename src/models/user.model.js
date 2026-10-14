const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  role: { type: String, enum: ["member", "admin", "superAdmin"], default: "member" },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["active", "disabled"], default: "active" },
  // 8-character recovery secret code (Argon2id hash): alternative to the email OTP at sign-in.
  secretCodeHash: { type: String, select: false },
  secretCodeSetAt: { type: Date, default: null },
  // Sessions issued before this moment are rejected (set on password or email change).
  credentialsChangedAt: { type: Date, default: null },
  lastLoginAt: Date,
}, { timestamps: true });

userSchema.index({ organizationId: 1, email: 1 });
userSchema.set("toJSON", { transform: (_doc, value) => {
  delete value.passwordHash;
  delete value.secretCodeHash;
  value.secretCodeSet = Boolean(value.secretCodeSetAt);
  return value;
} });

module.exports = mongoose.model("User", userSchema);
