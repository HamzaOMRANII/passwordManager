const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

function authMiddleware(config) {
  return async (req, res, next) => {
    try {
      const token = req.cookies.session;
      if (!token) return res.status(401).json({ success: false, error: "Authentication required" });
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      const user = await User.findOne({ _id: payload.sub, status: "active" });
      if (!user) return res.status(401).json({ success: false, error: "Invalid session" });
      if (user.credentialsChangedAt && payload.iat < Math.floor(user.credentialsChangedAt.getTime() / 1000)) {
        return res.status(401).json({ success: false, error: "Session ended after a password or email change. Sign in again." });
      }
      req.user = user;
      next();
    } catch (_error) {
      res.status(401).json({ success: false, error: "Invalid or expired session" });
    }
  };
}

// Blocks the vault until the signed-in user has set their 8-character secret code.
function requireSecretCode(req, res, next) {
  if (req.user.secretCodeSetAt) return next();
  return res.status(403).json({ success: false, code: "SECRET_CODE_REQUIRED", error: "Set your secret code to continue" });
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ success: false, error: "Insufficient permissions" });
}

module.exports = { authMiddleware, requireSecretCode, requireRole };
