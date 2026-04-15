import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for Shift's Electron E2E + visual snapshot tests.
 *
 * Run locally:   pnpm test:e2e
 * Update snaps:  pnpm test:e2e --update-snapshots
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",

  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },

  updateSnapshots: process.env.CI ? "none" : "missing",
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Electron can only run one instance at a time

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "visual",
      testIgnore: /perf\.spec/,
    },
    {
      name: "perf",
      testMatch: /perf\.spec/,
      timeout: 120_000,
    },
  ],
});
