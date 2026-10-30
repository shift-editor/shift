/**
 * Playwright E2E performance tests — real Electron app, GPU-accelerated.
 *
 * Boots the app, loads MutatorSans, generates a 50K-point glyph via
 * pasteContours, then benchmarks operations at scale.
 *
 * "position patch" samples time only the layer's preview patch, the model
 * update a drag frame starts with. "drag" samples move the real pointer and
 * time the frames that handle each move (hit testing, preview, every render
 * pass and the browser's paint), which is what a user sees.
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
import { localPoint } from "@shift/editor/spaces";
import * as fs from "fs";
import * as path from "path";
import type { PointId } from "@shift/types";
import type { Page } from "@playwright/test";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  installFrameProbe,
  measureMove,
  measureNudge,
  measurePanZoom,
  measurePositionPatch,
  measureUndoRedo,
  timeContourInsertion,
} from "./fixtures/perfProbe";
import {
  test,
  expect,
  benchmarkContours,
  drawBenchmarkGlyph,
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
 * Untimed frames run before the sampled ones. The first calls of a 50K-point edit compile and
 * size its hot paths, so they take several times a steady frame; with 30 samples, p95 is the
 * second-slowest frame and would measure that one-off warm-up instead of the per-frame cost.
 */
const WARMUP_FRAMES = 5;
const UNDO_REDO_SAMPLES = 10;

/**
 * Hard p95 ceilings per operation (ms). If p95 exceeds this, the test fails
 * regardless of baseline. Set generously — these catch "something is very
 * wrong" regressions, not gradual drift.
 */
const THRESHOLDS: Record<string, number> = {
  "position patch (5 pts)": 5,
  "position patch (1K pts)": 5,
  "position patch (all pts)": 20,
  // Provisional: whole frames on a 50K-point glyph take ~100 ms today; these catch worse.
  "drag work (1K pts)": 500,
  "drag frame (1K pts)": 500,
  "drag work (all pts)": 500,
  "drag frame (all pts)": 500,
  "nudge (all pts)": 60, // Immediate local interaction path; persistence settles asynchronously.
  "undo (all pts)": 1_000, // Full renderer↔utility ledger replay for a 50K-point patch.
  "redo (all pts)": 1_000,
  "pen input-to-render (100 clicks)": 500, // Includes browser input, persistence, and two frames.
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

/**
 * Inserts the 50K-point glyph, selects its last `count` points (all when
 * `null`), and fits the view. The last points are in the top row, clear of the
 * floating tools docked to the canvas's bottom edge, so a drag can start on the last one.
 */
async function selectInsertedPoints(
  editor: EditorDriver,
  count: number | null,
): Promise<PointId[]> {
  const inserted = await drawBenchmarkGlyph(editor, TARGET_POINTS);
  const pointIds = count === null ? inserted : inserted.slice(-count);
  await editor.selectObjects(pointIds);
  await editor.zoomToFit();
  await editor.waitForIdle();
  await editor.waitForCanvasRender();
  expect(await editor.selectionIds()).toHaveLength(count ?? pointIds.length);
  return pointIds;
}

/** Whether the page position `at` is under the canvas's floating tools. */
async function underFloatingTools(page: Page, at: { x: number; y: number }): Promise<boolean> {
  return page
    .locator(":root")
    .evaluate(
      (_root, { x, y }) =>
        Boolean(document.elementFromPoint(x, y)?.closest("[data-floating-toolbar]")),
      at,
    );
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
      `**Undo/redo samples:** ${UNDO_REDO_SAMPLES}`,
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

  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("53");
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

  test("setup: paste 50K points into the glyph", async ({ page, editor }) => {
    const contours = generateContourData(TARGET_POINTS);
    const insertion = await timeContourInsertion(page, contours);
    const settleStart = performance.now();
    await editor.waitForIdle();
    const settleMs = performance.now() - settleStart;
    await editor.waitForCanvasRender();
    const readyMs = performance.now() - settleStart;

    expect(insertion.count).toBeGreaterThanOrEqual(TARGET_POINTS);
    expect(settleMs, "50K-point edit must not block the renderer during confirmation").toBeLessThan(
      1_500,
    );
    expect(readyMs, "the canvas must be ready after the confirmed edit").toBeLessThan(2_000);

    const objects = page.getByRole("navigation", { name: "Glyph objects" });
    const rows = objects.locator('[data-testid^="object-"]');
    expect(await rows.count(), "the sidebar must mount only a viewport of rows").toBeLessThan(100);
    await objects.evaluate((nav) => {
      if (!nav.parentElement) throw new Error("Objects scroll container is missing");
      nav.parentElement.scrollTop = nav.parentElement.scrollHeight;
    });
    if (!insertion.lastId) throw new Error("Expected an inserted point");
    await expect(objects.getByTestId(`object-${insertion.lastId}`)).toBeVisible();
    expect(await rows.count()).toBeLessThan(100);
    console.log(
      `50K setup: insertion=${insertion.ms.toFixed(1)}ms settlement=${settleMs.toFixed(1)}ms ready=${readyMs.toFixed(1)}ms`,
    );
  });

  test("confirms five-point nudges on one and two sources at the same scale", async ({
    editor,
  }) => {
    const pointIds = (await drawBenchmarkGlyph(editor, TARGET_POINTS)).slice(0, 5);
    expect(pointIds).toHaveLength(5);
    await editor.waitForIdle();
    await editor.waitForCanvasRender();

    const before = (await editor.point(pointIds[0]!))!;
    await editor.selectObjects(pointIds);
    const singleStart = performance.now();
    await editor.press("ArrowRight");
    await editor.waitForCanvasRender();
    const singleMs = performance.now() - singleStart;
    expect(await editor.point(pointIds[0]!)).toMatchObject({ x: before.x + 1 });
    await editor.undo();
    expect(await editor.point(pointIds[0]!)).toEqual(before);

    await editor.addAxis({
      tag: "bch1",
      name: "Benchmark Weight",
      minimum: 100,
      default: 400,
      maximum: 900,
    });
    const reference = (await editor.source("default"))!.name;
    await editor.addSource("Benchmark Bold", { bch1: 900 });
    await editor.editSources([reference, "Benchmark Bold"]);
    await editor.waitForIdle();
    await expect.poll(async () => (await editor.matchedPoints(pointIds[0]!)).length).toBe(2);

    const targetPosition = async () => {
      const [, target] = await editor.matchedPoints(pointIds[0]!);
      if (!target) throw new Error("Expected a complete matched source");
      return { x: target.x, y: target.y };
    };
    const targetBefore = await targetPosition();
    await editor.selectObjects(pointIds);
    const multiStart = performance.now();
    await editor.press("ArrowRight");
    await editor.waitForCanvasRender();
    const multiMs = performance.now() - multiStart;

    expect(await editor.point(pointIds[0]!)).toMatchObject({ x: before.x + 1 });
    expect(await targetPosition()).toMatchObject({ x: targetBefore.x + 1 });
    await editor.undo();
    expect(await editor.point(pointIds[0]!)).toEqual(before);
    expect(await targetPosition()).toEqual(targetBefore);
    expect(singleMs).toBeLessThan(1_500);
    expect(multiMs).toBeLessThan(1_500);
    console.log(
      `50K five-point nudge: single=${singleMs.toFixed(1)}ms two-source=${multiMs.toFixed(1)}ms`,
    );
  });

  test("position patch — few points selected (5)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measurePositionPatch(page, {
      contours,
      count: 5,
      origin: { x: 100, y: 200 },
      frames: DRAG_FRAMES,
      warmup: WARMUP_FRAMES,
    });

    const stats = computeStats("position patch (5 pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("position patch — many points selected (~1000)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measurePositionPatch(page, {
      contours,
      count: 1000,
      origin: { x: 0, y: 0 },
      frames: DRAG_FRAMES,
      warmup: WARMUP_FRAMES,
    });

    const stats = computeStats("position patch (1K pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("position patch — all points selected", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measurePositionPatch(page, {
      contours,
      count: null,
      origin: { x: 0, y: 0 },
      frames: DRAG_FRAMES,
      warmup: WARMUP_FRAMES,
    });

    const stats = computeStats("position patch (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  for (const [label, count] of [
    ["1K pts", 1_000],
    ["all pts", null],
  ] as const) {
    test(`drag — real pointer frames with ${label} selected`, async ({ page, editor }) => {
      const pointIds = await selectInsertedPoints(editor, count);
      const grabbed = pointIds.at(-1)!;
      const other = pointIds[0]!;
      const before = {
        grabbed: (await editor.point(grabbed))!,
        other: (await editor.point(other))!,
      };

      const from = await editor.projectGlyphToPage(localPoint(before.grabbed.x, before.grabbed.y));
      const occluded = await underFloatingTools(page, from);
      expect(occluded, "the grabbed point is not under the floating tools").toBe(false);
      await editor.pointerDown(from);
      await editor.pointerMove({ x: from.x + 6, y: from.y - 3 });
      await expect.poll(() => editor.toolState()).toBe("translating");

      await installFrameProbe(page);
      const work: number[] = [];
      const frame: number[] = [];
      for (let step = 0; step < WARMUP_FRAMES + DRAG_FRAMES; step++) {
        const sample = await measureMove(page, {
          x: from.x + 8 + step * 2,
          y: from.y - 4 - (step % 7),
        });
        if (step < WARMUP_FRAMES) continue;
        work.push(sample.work);
        frame.push(sample.frame);
      }

      await editor.pointerUp();
      const after = {
        grabbed: (await editor.point(grabbed))!,
        other: (await editor.point(other))!,
      };
      const delta = {
        x: after.grabbed.x - before.grabbed.x,
        y: after.grabbed.y - before.grabbed.y,
      };
      expect(delta.x, "the drag moved the grabbed point").toBeGreaterThan(0);
      // The whole selection moved by the grabbed point's delta.
      expect(after.other).toMatchObject({
        x: before.other.x + delta.x,
        y: before.other.y + delta.y,
      });
      await editor.undo();
      expect(await editor.point(grabbed)).toEqual(before.grabbed);

      for (const stats of [
        computeStats(`drag work (${label})`, work),
        computeStats(`drag frame (${label})`, frame),
      ]) {
        results.push(stats);
        assertPerf(stats);
      }
    });
  }

  test("nudge — all points selected (arrow key hold)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measureNudge(page, {
      contours,
      frames: DRAG_FRAMES,
      warmup: WARMUP_FRAMES,
    });

    const stats = computeStats("nudge (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("undo/redo — rapid after translate", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measureUndoRedo(page, { contours, sampleCount: UNDO_REDO_SAMPLES });

    const undoStats = computeStats("undo (all pts)", samples.undo);
    const redoStats = computeStats("redo (all pts)", samples.redo);
    results.push(undoStats, redoStats);
    assertPerf(undoStats);
    assertPerf(redoStats);
  });

  test("pen tool — real clicks reach rendered geometry", async ({ page, editor }) => {
    await editor.draw({ contours: benchmarkContours(TARGET_POINTS) });
    await editor.selectTool("pen");
    await editor.waitForCanvasRender();

    const initialCount = await editor.pointCount();
    const before = await page.locator("#marker-canvas").screenshot();
    const bounds = await editor.canvasBounds();
    const samples: number[] = [];

    for (let index = 0; index < 100; index++) {
      const x =
        bounds.x + 25 + (Math.floor(index / 8) % 2 === 0 ? index % 8 : 7 - (index % 8)) * 20;
      const y = bounds.y + 80 + Math.floor(index / 8) * 20;
      const start = performance.now();

      await page.mouse.click(x, y);
      await editor.waitForCanvasRender();
      samples.push(performance.now() - start);
    }

    expect(await editor.pointCount()).toBe(initialCount + 100);
    expect((await page.locator("#marker-canvas").screenshot()).equals(before)).toBe(false);

    const stats = computeStats("pen input-to-render (100 clicks)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("pan/zoom — with all points selected", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await measurePanZoom(page, { contours, frames: DRAG_FRAMES });

    const panStats = computeStats("pan (all selected)", samples.pan);
    const zoomStats = computeStats("zoom (all selected)", samples.zoom);
    results.push(panStats, zoomStats);
    assertPerf(panStats);
    assertPerf(zoomStats);
  });
});
