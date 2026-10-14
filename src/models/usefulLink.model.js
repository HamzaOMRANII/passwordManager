const mongoose = require("mongoose");

const usefulLinkSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  category: { type: String, required: true, trim: true, maxlength: 80, index: true },
  url: { type: String, required: true, trim: true, maxlength: 2048 },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

usefulLinkSchema.index({ organizationId: 1, category: 1, url: 1 }, { unique: true });
module.exports = mongoose.model("UsefulLink", usefulLinkSchema);
