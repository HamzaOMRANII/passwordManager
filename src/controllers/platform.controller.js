const Platform = require("../models/platform.model");
const { audit } = require("../services/audit.service");

exports.list = async (req, res, next) => {
  try {
    const platforms = await Platform.find({ organizationId: req.user.organizationId, status: "active" }).sort({ name: 1 });
    res.json({ success: true, platforms });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const platform = await Platform.create({
      organizationId: req.user.organizationId,
      name: req.body.name,
      websiteUrl: req.body.websiteUrl,
      loginUrl: req.body.loginUrl,
      category: req.body.category,
      createdBy: req.user._id,
    });
    await audit(req, { action: "platform.created", result: "success", resourceType: "platform", resourceId: platform._id });
    res.status(201).json({ success: true, platform });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const allowed = ["name", "websiteUrl", "loginUrl", "category", "status"];
    const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const platform = await Platform.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId }, changes,
      { new: true, runValidators: true }
    );
    if (!platform) return res.status(404).json({ success: false, error: "Platform not found" });
    await audit(req, { action: "platform.updated", result: "success", resourceType: "platform", resourceId: platform._id });
    res.json({ success: true, platform });
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const platform = await Platform.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { status: "archived" }, { new: true }
    );
    if (!platform) return res.status(404).json({ success: false, error: "Platform not found" });
    await audit(req, { action: "platform.archived", result: "success", resourceType: "platform", resourceId: platform._id });
    res.json({ success: true });
  } catch (error) { next(error); }
};
