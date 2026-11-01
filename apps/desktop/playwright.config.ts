import os from "node:os";

import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for Shift's Electron E2E + visual snapshot tests.
 *
 * Run locally:   pnpm test:e2e
 * Update snaps:  pnpm test:e2e:visual:update
 *
 * Project membership is an explicit list of spec files. `scripts/check-e2e-projects.mjs`
 * fails CI when a spec belongs to no project or a golden bypasses `fixtures/snapshots.ts`.
 */

/** Native desktop boundaries: windows, menus, dialogs, quit, crash, recovery, and files. */
export const PLATFORM_SPECS = [
  "application-menu.spec.ts",
  "application-quit.spec.ts",
  "document-crash.spec.ts",
  "document-lifecycle.spec.ts",
  "document-recovery.spec.ts",
  "live-agent.spec.ts",
  "platform-integration.spec.ts",
  "recent-files.spec.ts",
  "variable-font-recovery.spec.ts",
  "window-behavior.spec.ts",
  "window-isolation.spec.ts",
];

/** Software-rendered editor, interaction, and golden coverage at a fixed 1200×600 viewport. */
export const VISUAL_SPECS = [
  "component-rendering.spec.ts",
  "deletion.spec.ts",
  "editor.spec.ts",
  "glyph-navigation.spec.ts",
  "glyph-rendering.spec.ts",
  "glyph-view.spec.ts",
  "handle-properties.spec.ts",
  "handle-snapping.spec.ts",
  "handle-styling.spec.ts",
  "hidpi-rendering.spec.ts",
  "home.spec.ts",
  "landing.spec.ts",
  "layer-reader.spec.ts",
  "pen-snapping.spec.ts",
  "preview-notice.spec.ts",
  "render-budget.spec.ts",
  "selector-contracts.spec.ts",
  "spacing.spec.ts",
  "svg-catalog.spec.ts",
  "theme.spec.ts",
  "tools.spec.ts",
  "canvas-focus.spec.ts",
  "variable-font-authoring.spec.ts",
  "variable-navigation.spec.ts",
  "variation-outlines.spec.ts",
];

/** Hardware-GPU Grid residency and preview presentation. */
export const GPU_SPECS = [
  "font-preview.spec.ts",
  "glyph-grid.spec.ts",
  "source-font-preview.spec.ts",
  "variable-font-preview.spec.ts",
  "variable-source-font-preview.spec.ts",
];

/** Opt-in interaction latency measurements on a hardware GPU. */
export const PERF_SPECS = ["perf.spec.ts", "multi-source-perf.spec.ts", "text-run-perf.spec.ts"];

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
  // One CI retry collects a second trace for diagnosis. Retry passes are reported as flaky
  // in the job summary, and goldens refuse to compare on retry (fixtures/snapshots.ts).
  retries: process.env.CI ? 1 : 0,
  // Every test launches its own Electron app with its own user-data directory, so a run
  // starts `workers` apps at once. CI sets `E2E_WORKERS` per job. Local runs default to half
  // the cores, at most four: visual specs emulate focus, so parallel apps do not race for it.
  // Platform specs need the OS focus and clipboard to themselves, and gpu and perf specs
  // measure the hardware GPU, so those projects stay at one worker unless `E2E_WORKERS` is set.
  workers: e2eWorkers(),
  reportSlowTests: { max: 10, threshold: 20_000 },
  // Shards write blob reports that CI merges into one HTML report and a flaky/slow summary.
  reporter: process.env.CI ? [["blob"], ["line"]] : [["list"]],

  use: {
    // Keep traces of every failed attempt: for a flaky test the first failure is the
    // evidence, and `on-first-retry` would only record the attempt that passed.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "visual", testMatch: VISUAL_SPECS },
    { name: "platform", testMatch: PLATFORM_SPECS, workers: 1 },
    { name: "gpu", testMatch: GPU_SPECS, workers: serialUnlessOverridden() },
    { name: "perf", testMatch: PERF_SPECS, timeout: 120_000, workers: serialUnlessOverridden() },
  ],
});

/** `E2E_WORKERS` when set; otherwise one on CI and half the cores (one to four) locally. */
function e2eWorkers(): number {
  if (process.env.E2E_WORKERS) return Number(process.env.E2E_WORKERS);

  if (process.env.CI) return 1;

  return Math.min(4, Math.max(1, Math.floor(os.availableParallelism() / 2)));
}

/** One worker for a project that needs the hardware to itself, unless `E2E_WORKERS` asks for more. */
function serialUnlessOverridden(): number | undefined {
  return process.env.E2E_WORKERS ? undefined : 1;
}
