const express = require("express");
const rateLimit = require("express-rate-limit");
const { authController } = require("../controllers/auth.controller");
const users = require("../controllers/user.controller");
const platforms = require("../controllers/platform.controller");
const vault = require("../controllers/vault.controller");
const usefulLinks = require("../controllers/usefulLink.controller");
const dataExport = require("../controllers/export.controller");
const { authMiddleware, requireSecretCode, requireRole } = require("../middleware/auth");

function createRoutes(config) {
  const router = express.Router();
  const session = authMiddleware(config);
  const auth = [session, requireSecretCode];
  const authActions = authController(config);
  const limiter = (limit, options = {}) => rateLimit({
    windowMs: 15 * 60 * 1000, limit, standardHeaders: "draft-8", ...options,
    message: { success: false, error: "Too many attempts. Wait 15 minutes and try again." },
  });
  const loginLimiter = limiter(10);
  const otpLimiter = limiter(10);
  const resendLimiter = limiter(4);
  // Only failed attempts count, so normal use (setting a code, exporting) is never blocked.
  const accountLimiter = limiter(20, { skipSuccessfulRequests: true });
  const profileLimiter = limiter(20, { skipSuccessfulRequests: true });

  router.post("/auth/signin", loginLimiter, authActions.signin);
  router.post("/auth/verify-email", otpLimiter, authActions.verifyEmail);
  router.post("/auth/resend-email", resendLimiter, authActions.resendEmail);
  router.post("/auth/verify-secret-code", otpLimiter, authActions.verifySecretCode);
  router.post("/auth/secret-code", session, accountLimiter, authActions.setSecretCode);
  router.post("/profile/password", auth, profileLimiter, authActions.changePassword);
  router.post("/profile/email", auth, profileLimiter, authActions.requestEmailChange);
  router.post("/profile/email/confirm", auth, profileLimiter, authActions.confirmEmailChange);
  router.post("/auth/signout", session, authActions.signout);
  router.get("/auth/me", session, authActions.me);
  router.get("/users", auth, requireRole("admin", "superAdmin"), users.list);
  router.get("/users/directory", auth, users.directory);
  router.post("/users", auth, requireRole("admin", "superAdmin"), users.create);
  router.patch("/users/:id", auth, requireRole("admin", "superAdmin"), users.update);
  router.delete("/users/:id", auth, requireRole("admin", "superAdmin"), users.remove);
  router.get("/platforms", auth, platforms.list);
  router.post("/platforms", auth, requireRole("admin", "superAdmin"), platforms.create);
  router.patch("/platforms/:id", auth, requireRole("admin", "superAdmin"), platforms.update);
  router.delete("/platforms/:id", auth, requireRole("admin", "superAdmin"), platforms.remove);
  router.get("/vault", auth, vault.list);
  router.get("/vault-access", auth, vault.accessMatrix);
  router.post("/vault", auth, vault.create);
  router.patch("/vault/:id", auth, vault.update);
  router.delete("/vault/:id", auth, vault.remove);
  router.post("/vault/:id/reveal", auth, vault.reveal);
  router.put("/vault/:id/grants", auth, vault.grant);
  router.delete("/vault/:id/grants/:userId", auth, vault.revokeGrant);
  router.get("/useful-links", auth, usefulLinks.list);
  router.post("/useful-links", auth, requireRole("admin", "superAdmin"), usefulLinks.create);
  router.patch("/useful-links/:id", auth, requireRole("admin", "superAdmin"), usefulLinks.update);
  router.delete("/useful-links/:id", auth, requireRole("admin", "superAdmin"), usefulLinks.remove);
  router.post("/export", auth, requireRole("superAdmin"), dataExport.exportDatabase);
  router.post("/export/excel", auth, requireRole("superAdmin"), accountLimiter, dataExport.exportExcel);
  return router;
}

module.exports = { createRoutes };
