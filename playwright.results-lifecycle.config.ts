import { defineConfig, devices } from "@playwright/test";

const port = 4175;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "results-lifecycle.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && tsx tests/e2e/results-server.ts",
    env: {
      APP_ORIGIN: `http://127.0.0.1:${String(port)}`,
      NODE_ENV: "production",
      PORT: String(port),
      RESULTS_LIFECYCLE_FIXTURE: "true",
    },
    url: `http://127.0.0.1:${String(port)}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "result-lifecycle-chromium", use: { ...devices["Desktop Chrome"] } }],
});
