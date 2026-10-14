const mongoose = require("mongoose");

const platformSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  websiteUrl: { type: String, trim: true, maxlength: 2048 },
  loginUrl: { type: String, trim: true, maxlength: 2048 },
  category: { type: String, trim: true, maxlength: 80 },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

platformSchema.index({ organizationId: 1, name: 1 });
module.exports = mongoose.model("Platform", platformSchema);
