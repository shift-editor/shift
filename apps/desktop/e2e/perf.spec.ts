/**
 * Playwright E2E performance tests — real Electron app, GPU-accelerated.
 *
 * Boots the app, loads MutatorSans, generates a 50K-point glyph via
 * pasteContours, then benchmarks operations at scale. Measures actual
 * frame times including React, signals, GPU compositing, and NAPI cost.
 *
 * ## Regression detection
 *
 * Two layers:
 * 1. **Hard thresholds** — p95 must stay under a fixed ceiling (e.g. 16.6ms
 *    for 60fps-budget operations). Catches catastrophic regressions.
 * 2. **Baseline comparison** — on CI, compares against `perf-baseline.json`.
 *    Fails if any operation regresses >30% vs baseline. Run with
 *    `PERF_UPDATE_BASELINE=1` to accept new numbers after intentional changes.
 */

import * as fs from "fs";
import * as path from "path";
import {
  test,
  expect,
  loadFont,
  navigateToEditor,
  generateContourData,
  computeStats,
  formatPerfTable,
  type PerfResult,
} from "./fixtures/perfApp";

const RESULTS_DIR = path.resolve(__dirname, "perf-results");
const BASELINE_PATH = path.resolve(__dirname, "perf-baseline.json");
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
  "nudge (all pts)": 60, // Already slow (see #36) — tighten after fix
  "undo (all pts)": 50,
  "redo (all pts)": 50,
  "pen-tool (100 clicks)": 500, // Spiky due to GC — tighten after optimization
  "pan (all selected)": 5,
  "zoom (all selected)": 5,
};

/** Allowed regression vs baseline before the test fails. */
const REGRESSION_TOLERANCE = 0.3; // 30%

type Baseline = Record<string, { p50: number; p95: number }>;

function loadBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
}

function saveBaseline(results: PerfResult[]): void {
  const baseline: Baseline = {};
  for (const r of results) {
    baseline[r.label] = { p50: r.p50, p95: r.p95 };
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
}

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

    // Update baseline if requested.
    if (process.env.PERF_UPDATE_BASELINE === "1") {
      saveBaseline(results);
      console.log(`Baseline updated: ${BASELINE_PATH}`);
    }
  });

  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    await navigateToEditor(page, "53");
  });

  /**
   * Assert hard threshold + baseline regression for a perf result.
   */
  function assertPerf(stats: PerfResult): void {
    // 1. Hard ceiling.
    const ceiling = THRESHOLDS[stats.label];
    if (ceiling !== undefined) {
      expect(
        stats.p95,
        `${stats.label}: p95 (${stats.p95.toFixed(2)}ms) exceeds hard ceiling (${ceiling}ms)`,
      ).toBeLessThanOrEqual(ceiling);
    }

    // 2. Baseline comparison — only when explicitly enabled.
    // Baselines are hardware-specific: a local M-series baseline doesn't apply
    // to CI runners. Set PERF_BASELINE_CHECK=1 when comparing against a
    // baseline recorded on the same hardware (e.g. CI comparing against its
    // own prior run).
    if (process.env.PERF_BASELINE_CHECK !== "1") return;

    const baseline = loadBaseline();
    if (!baseline || !baseline[stats.label]) return;

    const base = baseline[stats.label];
    // For near-zero baselines (sub-millisecond ops), allow up to 1ms absolute
    // jitter instead of a percentage — 0.00ms → 0.10ms isn't a real regression.
    const allowed = Math.max(base.p95 * (1 + REGRESSION_TOLERANCE), base.p95 + 1);

    expect(
      stats.p95,
      `${stats.label}: p95 regressed vs baseline (${base.p95.toFixed(2)}ms → ${stats.p95.toFixed(2)}ms, ceiling ${allowed.toFixed(2)}ms)`,
    ).toBeLessThanOrEqual(allowed);
  }

  test("setup: paste 50K points into the glyph", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const pointCount = await page.evaluate((data) => {
      const shift = (window as any).__shift;
      if (!shift) throw new Error("__shift not exposed — was the app built with __PLAYWRIGHT__?");

      const editor = shift.getEditor();
      const result = editor.bridge.pasteContours(data, 0, 0);

      if (!result.success) throw new Error("pasteContours failed");

      return editor.bridge
        .getEditingSnapshot()
        ?.contours.reduce((sum: number, c: any) => sum + c.points.length, 0);
    }, contours);

    expect(pointCount).toBeGreaterThanOrEqual(TARGET_POINTS);
    console.log(`Created glyph with ${pointCount} points`);
  });

  test("translate drag — few points selected (5)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);

        const snapshot = editor.bridge.getEditingSnapshot();
        const pointIds = snapshot.contours[0].points.slice(0, 5).map((p: any) => p.id);
        editor.selection.select(pointIds.map((id: string) => ({ kind: "point", id })));

        const draft = editor.createDraft();
        const times: number[] = [];

        for (let i = 0; i < frames; i++) {
          const start = performance.now();
          const updates = pointIds.map((id: string, idx: number) => ({
            node: { kind: "point" as const, id },
            x: 100 + i + idx,
            y: 200 + i + idx,
          }));
          draft.setPositions(updates);
          times.push(performance.now() - start);
        }

        draft.finish("translate-few");
        return times;
      },
      { contours, frames: DRAG_FRAMES },
    );

    const stats = computeStats("translate-drag (5 pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("translate drag — many points selected (~1000)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);

        const snapshot = editor.bridge.getEditingSnapshot();
        const allPoints = snapshot.contours.flatMap((c: any) => c.points);
        const pointIds = allPoints.slice(0, 1000).map((p: any) => p.id);
        editor.selection.select(pointIds.map((id: string) => ({ kind: "point", id })));

        const draft = editor.createDraft();
        const times: number[] = [];

        for (let i = 0; i < frames; i++) {
          const start = performance.now();
          const updates = pointIds.map((id: string, idx: number) => ({
            node: { kind: "point" as const, id },
            x: idx + i,
            y: idx + i,
          }));
          draft.setPositions(updates);
          times.push(performance.now() - start);
        }

        draft.finish("translate-many");
        return times;
      },
      { contours, frames: DRAG_FRAMES },
    );

    const stats = computeStats("translate-drag (1K pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("translate drag — all points selected", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);

        editor.selectAll();

        const snapshot = editor.bridge.getEditingSnapshot();
        const allPoints = snapshot.contours.flatMap((c: any) => c.points);
        const pointIds = allPoints.map((p: any) => p.id);

        const draft = editor.createDraft();
        const times: number[] = [];

        for (let i = 0; i < frames; i++) {
          const start = performance.now();
          const updates = pointIds.map((id: string, idx: number) => ({
            node: { kind: "point" as const, id },
            x: idx + i,
            y: idx + i,
          }));
          draft.setPositions(updates);
          times.push(performance.now() - start);
        }

        draft.finish("translate-all");
        return times;
      },
      { contours, frames: DRAG_FRAMES },
    );

    const stats = computeStats("translate-drag (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("nudge — all points selected (arrow key hold)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);
        editor.selectAll();

        const snapshot = editor.bridge.getEditingSnapshot();
        const allPoints = snapshot.contours.flatMap((c: any) => c.points);
        const pointIds = allPoints.map((p: any) => p.id);

        const times: number[] = [];

        for (let i = 0; i < frames; i++) {
          const start = performance.now();
          editor.nudgePoints(pointIds, 1, 0);
          times.push(performance.now() - start);
        }

        return times;
      },
      { contours, frames: DRAG_FRAMES },
    );

    const stats = computeStats("nudge (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("undo/redo — rapid after translate", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);
        editor.selectAll();

        const snapshot = editor.bridge.getEditingSnapshot();
        const allPoints = snapshot.contours.flatMap((c: any) => c.points);
        const pointIds = allPoints.map((p: any) => p.id);

        const draft = editor.createDraft();
        const updates = pointIds.map((id: string, idx: number) => ({
          node: { kind: "point" as const, id },
          x: idx + 10,
          y: idx + 10,
        }));
        draft.setPositions(updates);
        draft.finish("pre-undo-translate");

        const undoTimes: number[] = [];
        const redoTimes: number[] = [];

        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          editor.commandHistory.undo();
          undoTimes.push(performance.now() - t0);

          const t1 = performance.now();
          editor.commandHistory.redo();
          redoTimes.push(performance.now() - t1);
        }

        return { undo: undoTimes, redo: redoTimes };
      },
      { contours, frames: DRAG_FRAMES },
    );

    const undoStats = computeStats("undo (all pts)", samples.undo);
    const redoStats = computeStats("redo (all pts)", samples.redo);
    results.push(undoStats, redoStats);
    assertPerf(undoStats);
    assertPerf(redoStats);
  });

  test("pen tool — rapid point placement on complex glyph", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, clickCount }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);
        editor.setActiveTool("pen");

        const times: number[] = [];

        for (let i = 0; i < clickCount; i++) {
          const x = 100 + (i % 50) * 10;
          const y = 100 + Math.floor(i / 50) * 10;

          const start = performance.now();
          editor.toolManager.handlePointerDown(
            { x, y },
            { shiftKey: false, altKey: false, metaKey: false },
          );
          editor.toolManager.handlePointerUp({ x, y });
          times.push(performance.now() - start);
        }

        return times;
      },
      { contours, clickCount: 100 },
    );

    const stats = computeStats("pen-tool (100 clicks)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("pan/zoom — with all points selected", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      ({ contours, frames }) => {
        const editor = (window as any).__shift.getEditor();
        editor.bridge.pasteContours(contours, 0, 0);
        editor.selectAll();

        const panTimes: number[] = [];
        const zoomTimes: number[] = [];

        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          editor.setPan({ x: i * 10, y: i * 5 });
          panTimes.push(performance.now() - t0);

          const t1 = performance.now();
          editor.zoomToPoint(640, 400, 0.01);
          zoomTimes.push(performance.now() - t1);
        }

        return { pan: panTimes, zoom: zoomTimes };
      },
      { contours, frames: DRAG_FRAMES },
    );

    const panStats = computeStats("pan (all selected)", samples.pan);
    const zoomStats = computeStats("zoom (all selected)", samples.zoom);
    results.push(panStats, zoomStats);
    assertPerf(panStats);
    assertPerf(zoomStats);
  });
});
