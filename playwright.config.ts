import { defineConfig, devices } from "@playwright/test";

// Run through `npm run test:e2e`, which validates TEST_DATABASE_URL and applies migrations first.
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL must be supplied by scripts/run-e2e-tests.mjs.");

const API_PORT = 3101;
const WEB_PORT = 5174;
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

// Optional: use an installed browser (e.g. "chrome" or "msedge") instead of Playwright's bundled Chromium.
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e",
  // Every spec resets and reuses the one dedicated test database, so run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel,
  },
  webServer: [
    {
      command: "npx tsx server/src/index.ts",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        APP_ORIGIN: WEB_ORIGIN,
        NODE_ENV: "test",
      },
    },
    {
      command: `npm run dev --workspace client -- --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
