const { defineConfig } = require("@playwright/test");

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "21845";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${host}:${port}`;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `HOST=${host} PORT=${port} ./dev.sh`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
