import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["results.spec.ts", "claims.spec.ts", "wins.spec.ts", "kongs.spec.ts"],
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm start",
    env: {
      APP_ORIGIN: `http://127.0.0.1:${String(port)}`,
      NODE_ENV: "production",
      PORT: String(port),
    },
    url: `http://127.0.0.1:${String(port)}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet-chromium", use: { ...devices["iPad Pro 11"], browserName: "chromium" } },
    {
      name: "phone-portrait",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { height: 844, width: 390 },
      },
    },
    {
      name: "phone-landscape",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { height: 390, width: 844 },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
