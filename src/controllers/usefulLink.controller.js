const UsefulLink = require("../models/usefulLink.model");
const { audit } = require("../services/audit.service");

function normalizeUrl(value) {
  const candidate = /^https?:\/\//i.test(String(value || "")) ? String(value).trim() : `https://${String(value || "").trim()}`;
  const parsed = new URL(candidate);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS links are allowed");
  return parsed.toString();
}

exports.list = async (req, res, next) => {
  try {
    const links = await UsefulLink.find({ organizationId: req.user.organizationId, status: "active" }).sort({ category: 1, url: 1 });
    res.json({ success: true, links });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    if (!String(req.body.category || "").trim() || !String(req.body.url || "").trim()) {
      return res.status(400).json({ success: false, error: "Category and link are required" });
    }
    const link = await UsefulLink.create({
      organizationId: req.user.organizationId,
      category: req.body.category,
      url: normalizeUrl(req.body.url),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await audit(req, { action: "useful_link.created", result: "success", resourceType: "usefulLink", resourceId: link._id });
    res.status(201).json({ success: true, link });
  } catch (error) {
    if (error instanceof TypeError || error.message.includes("HTTP")) return res.status(400).json({ success: false, error: "Enter a valid HTTP or HTTPS link" });
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const changes = { updatedBy: req.user._id };
    if (req.body.category !== undefined) changes.category = String(req.body.category).trim();
    if (req.body.url !== undefined) changes.url = normalizeUrl(req.body.url);
    const link = await UsefulLink.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId, status: "active" },
      changes,
      { new: true, runValidators: true }
    );
    if (!link) return res.status(404).json({ success: false, error: "Link not found" });
    await audit(req, { action: "useful_link.updated", result: "success", resourceType: "usefulLink", resourceId: link._id });
    res.json({ success: true, link });
  } catch (error) {
    if (error instanceof TypeError || error.message.includes("HTTP")) return res.status(400).json({ success: false, error: "Enter a valid HTTP or HTTPS link" });
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const link = await UsefulLink.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId, status: "active" },
      { status: "archived", updatedBy: req.user._id },
      { new: true }
    );
    if (!link) return res.status(404).json({ success: false, error: "Link not found" });
    await audit(req, { action: "useful_link.archived", result: "success", resourceType: "usefulLink", resourceId: link._id });
    res.json({ success: true });
  } catch (error) { next(error); }
};
