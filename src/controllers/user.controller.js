const argon2 = require("argon2");
const User = require("../models/user.model");
const { audit } = require("../services/audit.service");

exports.list = async (req, res, next) => {
  try {
    const users = await User.find({ organizationId: req.user.organizationId }).sort({ firstName: 1, lastName: 1 });
    res.json({ success: true, users });
  } catch (error) { next(error); }
};

exports.directory = async (req, res, next) => {
  try {
    const users = await User.find({ organizationId: req.user.organizationId, status: "active" })
      .select("firstName lastName email role")
      .sort({ firstName: 1, lastName: 1 });
    res.json({ success: true, users });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const { firstName, lastName, role = "member" } = req.body;
    if (role === "superAdmin" && req.user.role !== "superAdmin") {
      return res.status(403).json({ success: false, error: "Only a super admin can create another super admin" });
    }
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 14) {
      return res.status(400).json({ success: false, error: "Valid name, email and a password of at least 14 characters are required" });
    }
    const user = await User.create({
      organizationId: req.user.organizationId, firstName, lastName, email, role,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    });
    await audit(req, { action: "user.created", result: "success", resourceType: "user", resourceId: user._id });
    res.status(201).json({ success: true, user });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    if (req.body.role === "superAdmin" && req.user.role !== "superAdmin") {
      return res.status(403).json({ success: false, error: "Only a super admin can assign the super-admin role" });
    }
    if (Object.hasOwn(req.body, "email")) {
      req.body.email = String(req.body.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(req.body.email)) {
        return res.status(400).json({ success: false, error: "A valid email address is required" });
      }
    }
    const allowed = ["firstName", "lastName", "email", "role", "status"];
    const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId }, changes,
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    await audit(req, { action: "user.updated", result: "success", resourceType: "user", resourceId: user._id });
    res.json({ success: true, user });
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: "You cannot disable your own account" });
    }
    const target = await User.findOne({ _id: req.params.id, organizationId: req.user.organizationId });
    if (!target) return res.status(404).json({ success: false, error: "User not found" });
    if (target.role === "superAdmin" && req.user.role !== "superAdmin") {
      return res.status(403).json({ success: false, error: "Only a super admin can disable another super admin" });
    }
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { status: "disabled" },
      { new: true }
    );
    await audit(req, { action: "user.disabled", result: "success", resourceType: "user", resourceId: user._id });
    res.json({ success: true, user });
  } catch (error) { next(error); }
};
