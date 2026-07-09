/**
 * Playwright E2E performance tests — real Electron app, GPU-accelerated.
 *
 * Each benchmark boots the app, loads MutatorSans, and generates a 50K-point
 * glyph before measuring one operation at scale. Mutation samples measure the
 * synchronous editor hot path; rendered-frame samples include reactive scene
 * rendering and WebGL marker submission on the next animation frame.
 *
 * Hard p95 thresholds guard the current performance envelope. Historical
 * comparisons belong in CI-generated benchmark artifacts because local and CI
 * hardware are not interchangeable baselines.
 */

import * as fs from "fs";
import * as path from "path";
import {
  test,
  expect,
  navigateToEditor,
  generateContourData,
  computeStats,
  formatPerfTable,
  type PerfResult,
} from "./fixtures/perfApp";

const RESULTS_DIR = path.resolve(__dirname, "perf-results");
const TARGET_POINTS = 50_000;
const DRAG_FRAMES = 30;

/**
 * Hard p95 ceilings per operation (ms). If p95 exceeds this, the test fails
 * regardless of baseline. Set generously — these catch "something is very
 * wrong" regressions, not gradual drift.
 */
const THRESHOLDS: Record<string, number> = {
  "translate-drag (5 pts)": 5,
  "translate-drag (1K pts)": 5,
  "translate-drag (all pts)": 20,
  "rendered translate (all pts)": 750,
  "nudge enqueue (all pts)": 60,
  "undo (all pts)": 750,
  "redo (all pts)": 750,
  "pen-tool (100 clicks)": 500, // Spiky due to GC — tighten after optimization
  "pan frame (all selected)": 750,
  "zoom frame (all selected)": 50,
};

test.describe("Performance — 50K points", () => {
  const results: PerfResult[] = [];

  test.beforeAll(() => {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
  });

  test.afterAll(() => {
    if (results.length === 0) return;

    // Write timestamped report.
    const table = formatPerfTable(results);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(RESULTS_DIR, `perf-${timestamp}.md`);

    const report = [
      `# Perf Report — ${new Date().toISOString()}`,
      "",
      `**Scale:** ${TARGET_POINTS.toLocaleString()} points`,
      `**Drag frames:** ${DRAG_FRAMES}`,
      "",
      table,
      "",
    ].join("\n");

    fs.writeFileSync(reportPath, report);
    console.log(`\nPerf report written to: ${reportPath}`);
    console.log(table);
  });

  test.beforeEach(async ({ workspacePage: page }) => {
    await navigateToEditor(page, "53");
  });

  /**
   * Assert the hard p95 threshold for a perf result.
   */
  function assertPerf(stats: PerfResult): void {
    const ceiling = THRESHOLDS[stats.label];
    if (ceiling !== undefined) {
      expect(
        stats.p95,
        `${stats.label}: p95 (${stats.p95.toFixed(2)}ms) exceeds hard ceiling (${ceiling}ms)`,
      ).toBeLessThanOrEqual(ceiling);
    }
  }

  test("editor and GPU workloads at 50K points", async ({ workspacePage: page }) => {
    test.setTimeout(240_000);

    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      async ({ contours, frames }) => {
        if (!window.shiftPerf) throw new Error("Shift perf harness is unavailable");

        const pointCount = await window.shiftPerf.insertContours(contours);
        const translate5 = await window.shiftPerf.translate(5, frames);
        const translate1K = await window.shiftPerf.translate(1000, frames);
        const translateAll = await window.shiftPerf.translateRendered(frames);
        const history = await window.shiftPerf.undoRedo(frames);
        const pen = await window.shiftPerf.placePoints(100);
        const viewport = await window.shiftPerf.panZoom(frames);

        // Keep enqueue-only work last: intentionally waiting for thirty queued
        // persistence operations would measure a different contract.
        const nudge = window.shiftPerf.nudgeEnqueue(frames);

        return {
          pointCount,
          translate5,
          translate1K,
          translateAll,
          history,
          pen,
          viewport,
          nudge,
        };
      },
      { contours, frames: DRAG_FRAMES },
    );

    expect(samples.pointCount).toBeGreaterThanOrEqual(TARGET_POINTS);

    results.push(
      computeStats("translate-drag (5 pts)", samples.translate5),
      computeStats("translate-drag (1K pts)", samples.translate1K),
      computeStats("translate-drag (all pts)", samples.translateAll.mutation),
      computeStats("rendered translate (all pts)", samples.translateAll.frame),
      computeStats("undo (all pts)", samples.history.undo),
      computeStats("redo (all pts)", samples.history.redo),
      computeStats("pen-tool (100 clicks)", samples.pen),
      computeStats("pan frame (all selected)", samples.viewport.pan),
      computeStats("zoom frame (all selected)", samples.viewport.zoom),
      computeStats("nudge enqueue (all pts)", samples.nudge),
    );

    for (const stats of results) assertPerf(stats);
  });
});
