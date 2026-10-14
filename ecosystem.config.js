module.exports = {
  apps: [{
    name: "sec-vault-dev",
    script: "src/server.js",
    cwd: __dirname,
    watch: ["src"],
    ignore_watch: ["src/client", "node_modules", "dist"],
    env: { NODE_ENV: "development", PORT: 11000 },
  }],
};
