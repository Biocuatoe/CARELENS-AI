import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  // E2E_BASE_URL = an already running frontend (for example the Vite dev server on :5173): nothing is built or started.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 180_000,
    // The login flows run against a network-level fake of the backend at this origin (e2e/helpers.ts); nothing real is contacted.
    env: { VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787" },
  },
});
