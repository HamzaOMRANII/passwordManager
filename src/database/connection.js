const mongoose = require("mongoose");

async function connectDB(mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri, { family: 4, serverSelectionTimeoutMS: 10000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

async function disconnectDB() {
  if (mongoose.connection.readyState) await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
