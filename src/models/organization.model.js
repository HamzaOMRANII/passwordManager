const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  primaryDomain: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ["active", "disabled"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("Organization", organizationSchema);
