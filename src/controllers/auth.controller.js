const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const AuthChallenge = require("../models/authChallenge.model");
const { createEmailService } = require("../services/email.service");
const { audit } = require("../services/audit.service");

const OTP_TTL_MINUTES = 10;
const OTP_ATTEMPTS = 5;
// Any 8 non-space characters: digits only, letters only, or a mix.
const SECRET_CODE_PATTERN = /^\S{8}$/;
const SECRET_CODE_RULE = "The secret code must be exactly 8 characters, without spaces";

function digestCode(challengeId, code, secret) {
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setSessionCookie(res, user, config) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { algorithm: "HS256", expiresIn: "8h" });
  res.cookie("session", token, {
    httpOnly: true,
    secure: config.https,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
}

// Finds an open sign-in challenge (created after a correct password).
async function openChallenge(challengeId) {
  if (!mongoose.isValidObjectId(challengeId)) return null;
  return AuthChallenge.findOne({
    _id: challengeId,
    usedAt: null,
    expiresAt: { $gt: new Date() },
    attemptsRemaining: { $gt: 0 },
    purpose: { $ne: "email_change" },
  }).select("+code +codeDigest");
}

async function completeLogin(req, res, config, challenge, action) {
  challenge.usedAt = new Date();
  challenge.code = undefined;
  await challenge.save();
  const user = await User.findOne({ _id: challenge.userId, status: "active" });
  if (!user) return res.status(401).json({ success: false, error: "User account is unavailable" });
  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  setSessionCookie(res, user, config);
  await audit(req, { action, result: "success", resourceType: "user", resourceId: user._id });
  res.json({ success: true, user: user.toJSON() });
}

function authController(config) {
  const emailService = createEmailService(config);
  return {
    signin: async (req, res, next) => {
      try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const user = await User.findOne({ email, status: "active" }).select("+passwordHash");
        if (!user || !(await argon2.verify(user.passwordHash, String(req.body.password || "")))) {
          await audit(req, { action: "auth.password_failed", result: "failure", metadata: { email } });
          return res.status(401).json({ success: false, error: "Incorrect email or password" });
        }

        req.user = user;
        await AuthChallenge.deleteMany({ userId: user._id, usedAt: null });
        const code = crypto.randomInt(10000000, 100000000).toString();
        const challenge = new AuthChallenge({
          userId: user._id,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
          attemptsRemaining: OTP_ATTEMPTS,
          sendCount: 1,
          lastSentAt: new Date(),
          requestedIp: req.ip,
          code,
          codeDigest: "pending",
        });
        challenge.codeDigest = digestCode(challenge._id, code, config.jwtSecret);
        await challenge.save();
        try {
          await emailService.sendLoginCode({ to: user.email, code, expiresInMinutes: OTP_TTL_MINUTES });
        } catch (emailError) {
          const secretCodeAvailable = Boolean(user.secretCodeSetAt);
          if (!secretCodeAvailable) await AuthChallenge.deleteOne({ _id: challenge._id });
          console.error("OTP email delivery failed", emailError.message);
          const authenticationFailed = emailError.responseCode === 535 || /invalid login|credentials invalid|username and password not accepted/i.test(emailError.message);
          return res.status(502).json({
            success: false,
            code: authenticationFailed ? "SMTP_AUTH_FAILED" : "OTP_DELIVERY_FAILED",
            ...(secretCodeAvailable && { challengeId: challenge.id, secretCodeAvailable }),
            error: authenticationFailed && !config.production
              ? "SMTP authentication failed. Update the sender mailbox password in .env and restart the application."
              : "Verification email could not be sent. Please try again or contact your administrator.",
          });
        }
        await audit(req, { action: "auth.otp_sent", result: "success", resourceType: "user", resourceId: user._id });
        res.json({ success: true, requiresOtp: true, challengeId: challenge.id, maskedEmail: user.email.replace(/(^.).*(@.*$)/, "$1***$2") });
      } catch (error) { next(error); }
    },

    verifyEmail: async (req, res, next) => {
      try {
        const challenge = await openChallenge(req.body.challengeId);
        if (!challenge) return res.status(400).json({ success: false, error: "Verification code is expired or invalid" });

        const supplied = digestCode(challenge._id, String(req.body.code || ""), config.jwtSecret);
        if (!safeEqual(supplied, challenge.codeDigest)) {
          challenge.attemptsRemaining -= 1;
          await challenge.save();
          return res.status(400).json({ success: false, error: "Incorrect verification code" });
        }

        await completeLogin(req, res, config, challenge, "auth.login");
      } catch (error) { next(error); }
    },

    // Recovery path: password (step 1) + secret code instead of the email OTP.
    verifySecretCode: async (req, res, next) => {
      try {
        const challenge = await openChallenge(req.body.challengeId);
        if (!challenge) return res.status(400).json({ success: false, error: "Sign-in request expired. Sign in again with your password." });
        const user = await User.findOne({ _id: challenge.userId, status: "active" }).select("+secretCodeHash");
        if (!user) return res.status(401).json({ success: false, error: "User account is unavailable" });
        req.user = user;
        if (!user.secretCodeHash) {
          return res.status(400).json({ success: false, error: "No secret code is set for this account. Use the email code." });
        }
        if (!(await argon2.verify(user.secretCodeHash, String(req.body.secretCode || "")))) {
          challenge.attemptsRemaining -= 1;
          await challenge.save();
          await audit(req, { action: "auth.secret_code_failed", result: "failure", resourceType: "user", resourceId: user._id });
          return res.status(400).json({ success: false, error: `Incorrect secret code (${challenge.attemptsRemaining} attempts left)` });
        }
        await completeLogin(req, res, config, challenge, "auth.login_secret_code");
        emailService.sendSecurityNotice({ to: user.email, change: "Someone signed in to your SEC VAULT account with your secret code" })
          .catch((error) => console.error("Security notice failed", error.message));
      } catch (error) { next(error); }
    },

    // First-time setup needs only the signed-in session; changing an existing code also needs the account password.
    setSecretCode: async (req, res, next) => {
      try {
        const secretCode = String(req.body.secretCode || "");
        if (!SECRET_CODE_PATTERN.test(secretCode)) return res.status(400).json({ success: false, error: SECRET_CODE_RULE });
        const user = await User.findById(req.user._id).select("+passwordHash +secretCodeHash");
        const changing = Boolean(user.secretCodeHash);
        if (changing && !(await argon2.verify(user.passwordHash, String(req.body.currentPassword || "")))) {
          await audit(req, { action: "auth.secret_code_change_failed", result: "failure", resourceType: "user", resourceId: user._id });
          return res.status(401).json({ success: false, error: "Current password is incorrect" });
        }
        if (await argon2.verify(user.passwordHash, secretCode)) {
          return res.status(400).json({ success: false, error: "The secret code must be different from your password" });
        }
        user.secretCodeHash = await argon2.hash(secretCode, { type: argon2.argon2id });
        user.secretCodeSetAt = new Date();
        await user.save();
        await audit(req, { action: changing ? "auth.secret_code_changed" : "auth.secret_code_set", result: "success", resourceType: "user", resourceId: user._id });
        res.json({ success: true, user: user.toJSON() });
      } catch (error) { next(error); }
    },

    resendEmail: async (req, res, next) => {
      try {
        if (!mongoose.isValidObjectId(req.body.challengeId)) {
          return res.status(400).json({ success: false, error: "Verification request is invalid" });
        }
        const challenge = await AuthChallenge.findOne({
          _id: req.body.challengeId,
          usedAt: null,
          attemptsRemaining: { $gt: 0 },
        }).select("+code +codeDigest");
        if (!challenge || challenge.sendCount >= 4) {
          return res.status(429).json({ success: false, error: "Maximum resend limit reached. Sign in again to start a new request." });
        }
        if (Date.now() - challenge.lastSentAt.getTime() < 30 * 1000) {
          return res.status(429).json({ success: false, error: "Wait 30 seconds before requesting another code." });
        }
        const user = await User.findOne({ _id: challenge.userId, status: "active" });
        if (!user) return res.status(401).json({ success: false, error: "User account is unavailable" });
        const code = crypto.randomInt(10000000, 100000000).toString();
        challenge.code = code;
        challenge.codeDigest = digestCode(challenge._id, code, config.jwtSecret);
        challenge.expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
        challenge.attemptsRemaining = OTP_ATTEMPTS;
        challenge.sendCount += 1;
        challenge.lastSentAt = new Date();
        await challenge.save();
        try {
          await emailService.sendLoginCode({ to: user.email, code, expiresInMinutes: OTP_TTL_MINUTES });
        } catch (emailError) {
          await AuthChallenge.deleteOne({ _id: challenge._id });
          console.error("OTP resend failed", emailError.message);
          return res.status(502).json({ success: false, error: "A new verification code could not be sent" });
        }
        req.user = user;
        await audit(req, { action: "auth.otp_resent", result: "success", resourceType: "user", resourceId: user._id });
        res.json({ success: true, challengeId: challenge.id, maskedEmail: user.email.replace(/(^.).*(@.*$)/, "$1***$2") });
      } catch (error) { next(error); }
    },

    // Profile: change password (current password required). Other sessions are signed out.
    changePassword: async (req, res, next) => {
      try {
        const currentPassword = String(req.body.currentPassword || "");
        const newPassword = String(req.body.newPassword || "");
        const user = await User.findById(req.user._id).select("+passwordHash");
        if (!(await argon2.verify(user.passwordHash, currentPassword))) {
          await audit(req, { action: "profile.password_change_failed", result: "failure", resourceType: "user", resourceId: user._id });
          return res.status(401).json({ success: false, error: "Current password is incorrect" });
        }
        if (newPassword.length < 14) return res.status(400).json({ success: false, error: "The new password must be at least 14 characters" });
        if (newPassword === currentPassword) return res.status(400).json({ success: false, error: "The new password must be different from the current one" });
        user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
        user.credentialsChangedAt = new Date();
        await user.save();
        setSessionCookie(res, user, config);
        await audit(req, { action: "profile.password_changed", result: "success", resourceType: "user", resourceId: user._id });
        emailService.sendSecurityNotice({ to: user.email, change: "Your SEC VAULT password was changed" })
          .catch((error) => console.error("Security notice failed", error.message));
        res.json({ success: true, user: user.toJSON() });
      } catch (error) { next(error); }
    },

    // Profile: step 1 of an email change. Sends a code to the NEW address to prove it is reachable.
    requestEmailChange: async (req, res, next) => {
      try {
        const newEmail = String(req.body.newEmail || "").trim().toLowerCase();
        const user = await User.findById(req.user._id).select("+passwordHash");
        if (!(await argon2.verify(user.passwordHash, String(req.body.currentPassword || "")))) {
          await audit(req, { action: "profile.email_change_failed", result: "failure", resourceType: "user", resourceId: user._id });
          return res.status(401).json({ success: false, error: "Current password is incorrect" });
        }
        if (!/^\S+@\S+\.\S+$/.test(newEmail) || newEmail.length > 254) return res.status(400).json({ success: false, error: "Enter a valid email address" });
        if (newEmail === user.email) return res.status(400).json({ success: false, error: "This is already your email address" });
        if (await User.exists({ email: newEmail })) return res.status(409).json({ success: false, error: "This email address is already used by another account" });

        await AuthChallenge.deleteMany({ userId: user._id, purpose: "email_change", usedAt: null });
        const code = crypto.randomInt(10000000, 100000000).toString();
        const challenge = new AuthChallenge({
          userId: user._id,
          purpose: "email_change",
          pendingEmail: newEmail,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
          attemptsRemaining: OTP_ATTEMPTS,
          requestedIp: req.ip,
          codeDigest: "pending",
        });
        challenge.codeDigest = digestCode(challenge._id, code, config.jwtSecret);
        await challenge.save();
        try {
          await emailService.sendLoginCode({ to: newEmail, code, expiresInMinutes: OTP_TTL_MINUTES });
        } catch (emailError) {
          await AuthChallenge.deleteOne({ _id: challenge._id });
          console.error("Email-change code delivery failed", emailError.message);
          return res.status(502).json({ success: false, error: "The verification code could not be sent to the new address" });
        }
        await audit(req, { action: "profile.email_change_requested", result: "success", resourceType: "user", resourceId: user._id });
        res.json({ success: true, challengeId: challenge.id, maskedEmail: newEmail.replace(/(^.).*(@.*$)/, "$1***$2") });
      } catch (error) { next(error); }
    },

    // Profile: step 2 of an email change. Applies the new address once its code is confirmed.
    confirmEmailChange: async (req, res, next) => {
      try {
        if (!mongoose.isValidObjectId(req.body.challengeId)) return res.status(400).json({ success: false, error: "Verification code is expired or invalid" });
        const challenge = await AuthChallenge.findOne({
          _id: req.body.challengeId,
          userId: req.user._id,
          purpose: "email_change",
          usedAt: null,
          expiresAt: { $gt: new Date() },
          attemptsRemaining: { $gt: 0 },
        }).select("+codeDigest");
        if (!challenge) return res.status(400).json({ success: false, error: "Verification code is expired or invalid. Request a new one." });
        const supplied = digestCode(challenge._id, String(req.body.code || ""), config.jwtSecret);
        if (!safeEqual(supplied, challenge.codeDigest)) {
          challenge.attemptsRemaining -= 1;
          await challenge.save();
          return res.status(400).json({ success: false, error: `Incorrect verification code (${challenge.attemptsRemaining} attempts left)` });
        }
        if (await User.exists({ email: challenge.pendingEmail, _id: { $ne: req.user._id } })) {
          return res.status(409).json({ success: false, error: "This email address is already used by another account" });
        }
        challenge.usedAt = new Date();
        await challenge.save();
        const user = await User.findById(req.user._id);
        const previousEmail = user.email;
        user.email = challenge.pendingEmail;
        user.credentialsChangedAt = new Date();
        await user.save();
        setSessionCookie(res, user, config);
        await audit(req, { action: "profile.email_changed", result: "success", resourceType: "user", resourceId: user._id, metadata: { from: previousEmail, to: user.email } });
        emailService.sendSecurityNotice({ to: previousEmail, change: `Your SEC VAULT sign-in email was changed to ${user.email.replace(/(^.).*(@.*$)/, "$1***$2")}` })
          .catch((error) => console.error("Security notice failed", error.message));
        res.json({ success: true, user: user.toJSON() });
      } catch (error) { next(error); }
    },

    signout: async (req, res) => {
      res.clearCookie("session", { path: "/" });
      await audit(req, { action: "auth.logout", result: "success" });
      res.json({ success: true });
    },
    me: (req, res) => res.json({ success: true, user: req.user }),
  };
}

module.exports = { authController };
