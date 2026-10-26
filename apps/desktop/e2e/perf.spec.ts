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
import type { ScreenPoint } from "@shift/editor/spaces";

import * as fs from "fs";
import * as path from "path";
import type { PointId } from "@shift/types";
import type { ExternalAxisLocation } from "@shift/editor/types";
import type { Page } from "@playwright/test";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { installFrameProbe, measureMove } from "./fixtures/frameProbe";
import {
  test,
  expect,
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
  page: Page,
  editor: EditorDriver,
  count: number | null,
): Promise<PointId[]> {
  const pointIds = await page.evaluate(
    ({ contours, count }) => {
      const runtime = window.shift!.editor;
      const inserted = runtime.insertContent({ contours });
      if (!inserted) throw new Error("contour insertion failed");
      const ids = (count === null ? inserted : inserted.slice(-count)) as PointId[];
      runtime.selection.select(ids);
      runtime.zoomToFit();
      return ids;
    },
    { contours: generateContourData(TARGET_POINTS), count },
  );
  await editor.waitForIdle();
  await editor.waitForCanvasRender();
  expect(await editor.selectionIds()).toHaveLength(count ?? pointIds.length);
  return pointIds;
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
    const insertion = await page.evaluate((data) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("shift runtime API not exposed");

      const start = performance.now();
      const inserted = workspace.editor.insertContent({ contours: data });
      if (!inserted) throw new Error("contour insertion failed");
      return { count: inserted.length, lastId: inserted.at(-1), ms: performance.now() - start };
    }, contours);
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
    page,
    editor,
  }) => {
    const pointIds = await page.evaluate((contours) => {
      const runtime = window.shift!.editor;
      const inserted = runtime.insertContent({ contours });
      if (!inserted) throw new Error("contour insertion failed");
      return inserted.slice(0, 5) as PointId[];
    }, generateContourData(TARGET_POINTS));
    expect(pointIds).toHaveLength(5);
    await editor.waitForIdle();
    await editor.waitForCanvasRender();

    const before = await editor.pointPosition(pointIds[0]!);
    await page.evaluate((ids) => window.shift!.editor.selection.select(ids), pointIds);
    const singleStart = performance.now();
    await editor.press("ArrowRight");
    await editor.waitForCanvasRender();
    const singleMs = performance.now() - singleStart;
    expect(await editor.pointPosition(pointIds[0]!)).toMatchObject({ x: before.x + 1 });
    await editor.undo();
    expect(await editor.pointPosition(pointIds[0]!)).toEqual(before);

    const axisId = await page.evaluate(() =>
      window.shift!.editor.font.createAxis({
        tag: "bch1",
        name: "Benchmark Weight",
        role: "external",
        axisType: "continuous",
        minimum: 100,
        default: 400,
        maximum: 900,
        labels: [],
        hidden: false,
      }),
    );
    await editor.waitForIdle();
    const sourceIds = await page.evaluate((axisId) => {
      const runtime = window.shift!.editor;
      const referenceId = runtime.font.defaultSource.id;
      const location = new Map([[axisId, 900]]) as unknown as ExternalAxisLocation;
      const targetId = runtime.font.createSource("Benchmark Bold", location);
      return { referenceId, targetId };
    }, axisId);
    await editor.waitForIdle();
    await expect
      .poll(() =>
        page.evaluate((id) => Boolean(window.shift!.editor.font.source(id)), sourceIds.targetId),
      )
      .toBe(true);
    await page.evaluate(({ referenceId, targetId }) => {
      const runtime = window.shift!.editor;
      runtime.selectSourceForEditing(targetId);
      runtime.selectSourceForEditing(referenceId);
      runtime.selectSourceForEditing(targetId, "toggle");
    }, sourceIds);
    await editor.waitForIdle();
    await expect
      .poll(() =>
        page.evaluate(
          (ids) => window.shift!.editor.positionSelection(ids)?.additionalLayers.length,
          pointIds,
        ),
      )
      .toBe(1);

    const targetPosition = async () =>
      page.evaluate((ids) => {
        const selection = window.shift!.editor.positionSelection(ids);
        const target = selection?.additionalLayers[0];
        const targetId = target?.targets.points?.[0];
        if (!target || !targetId) throw new Error("Expected a complete matched source");
        const point = target.layer.point(targetId);
        if (!point) throw new Error("Expected a matched point");
        return { x: point.x, y: point.y };
      }, pointIds);
    const targetBefore = await targetPosition();
    await page.evaluate((ids) => window.shift!.editor.selection.select(ids), pointIds);
    const multiStart = performance.now();
    await editor.press("ArrowRight");
    await editor.waitForCanvasRender();
    const multiMs = performance.now() - multiStart;

    expect(await editor.pointPosition(pointIds[0]!)).toMatchObject({ x: before.x + 1 });
    expect(await targetPosition()).toMatchObject({ x: targetBefore.x + 1 });
    await editor.undo();
    expect(await editor.pointPosition(pointIds[0]!)).toEqual(before);
    expect(await targetPosition()).toEqual(targetBefore);
    expect(singleMs).toBeLessThan(1_500);
    expect(multiMs).toBeLessThan(1_500);
    console.log(
      `50K five-point nudge: single=${singleMs.toFixed(1)}ms two-source=${multiMs.toFixed(1)}ms`,
    );
  });

  test("position patch — few points selected (5)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      async ({ contours, frames, warmup }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const pointIds = editor.selection.ids.slice(0, 5) as readonly PointId[];
        const layer = editor.layerForGeometry({ points: pointIds });
        if (!layer) throw new Error("selected points have no editable layer");

        let updates = pointIds.map((id, index) => ({
          kind: "point" as const,
          id,
          x: 100 + index,
          y: 200 + index,
        }));
        const times: number[] = [];

        for (let index = -warmup; index < frames; index++) {
          const start = performance.now();
          updates = pointIds.map((id, pointIndex) => ({
            kind: "point" as const,
            id,
            x: 100 + index + pointIndex,
            y: 200 + index + pointIndex,
          }));
          layer.previewPositionPatch(updates);
          if (index >= 0) times.push(performance.now() - start);
        }

        layer.applyPositionPatch(updates);
        await editor.font.editCoordinator.settled();
        return times;
      },
      { contours, frames: DRAG_FRAMES, warmup: WARMUP_FRAMES },
    );

    const stats = computeStats("position patch (5 pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("position patch — many points selected (~1000)", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      async ({ contours, frames, warmup }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const pointIds = editor.selection.ids.slice(0, 1000) as readonly PointId[];
        const layer = editor.layerForGeometry({ points: pointIds });
        if (!layer) throw new Error("selected points have no editable layer");

        let updates = pointIds.map((id, index) => ({
          kind: "point" as const,
          id,
          x: index,
          y: index,
        }));
        const times: number[] = [];

        for (let index = -warmup; index < frames; index++) {
          const start = performance.now();
          updates = pointIds.map((id, pointIndex) => ({
            kind: "point" as const,
            id,
            x: pointIndex + index,
            y: pointIndex + index,
          }));
          layer.previewPositionPatch(updates);
          if (index >= 0) times.push(performance.now() - start);
        }

        layer.applyPositionPatch(updates);
        await editor.font.editCoordinator.settled();
        return times;
      },
      { contours, frames: DRAG_FRAMES, warmup: WARMUP_FRAMES },
    );

    const stats = computeStats("position patch (1K pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("position patch — all points selected", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      async ({ contours, frames, warmup }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const pointIds = editor.selection.ids as readonly PointId[];
        const layer = editor.layerForGeometry({ points: pointIds });
        if (!layer) throw new Error("selected points have no editable layer");

        let updates = pointIds.map((id, index) => ({
          kind: "point" as const,
          id,
          x: index,
          y: index,
        }));
        const times: number[] = [];

        for (let index = -warmup; index < frames; index++) {
          const start = performance.now();
          updates = pointIds.map((id, pointIndex) => ({
            kind: "point" as const,
            id,
            x: pointIndex + index,
            y: pointIndex + index,
          }));
          layer.previewPositionPatch(updates);
          if (index >= 0) times.push(performance.now() - start);
        }

        layer.applyPositionPatch(updates);
        await editor.font.editCoordinator.settled();
        return times;
      },
      { contours, frames: DRAG_FRAMES, warmup: WARMUP_FRAMES },
    );

    const stats = computeStats("position patch (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  for (const [label, count] of [
    ["1K pts", 1_000],
    ["all pts", null],
  ] as const) {
    test(`drag — real pointer frames with ${label} selected`, async ({ page, editor }) => {
      const pointIds = await selectInsertedPoints(page, editor, count);
      const grabbed = pointIds.at(-1)!;
      const other = pointIds[0]!;
      const before = {
        grabbed: await editor.pointPosition(grabbed),
        other: await editor.pointPosition(other),
      };

      const from = await editor.projectGlyphToPage(before.grabbed);
      const occluded = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-floating-toolbar]")),
        from,
      );
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
        grabbed: await editor.pointPosition(grabbed),
        other: await editor.pointPosition(other),
      };
      const delta = {
        x: after.grabbed.x - before.grabbed.x,
        y: after.grabbed.y - before.grabbed.y,
      };
      expect(delta.x, "the drag moved the grabbed point").toBeGreaterThan(0);
      // The whole selection moved by the grabbed point's delta.
      expect(after.other).toEqual({ x: before.other.x + delta.x, y: before.other.y + delta.y });
      await editor.undo();
      expect(await editor.pointPosition(grabbed)).toEqual(before.grabbed);

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

    const samples = await page.evaluate(
      async ({ contours, frames, warmup }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const pointIds = editor.selection.ids as readonly PointId[];
        const layer = editor.layerForGeometry({ points: pointIds });
        if (!layer) throw new Error("selected points have no editable layer");

        const times: number[] = [];

        for (let index = -warmup; index < frames; index++) {
          const start = performance.now();
          layer.movePoints(pointIds, { x: 1, y: 0 });
          if (index >= 0) times.push(performance.now() - start);
        }

        return times;
      },
      { contours, frames: DRAG_FRAMES, warmup: WARMUP_FRAMES },
    );

    const stats = computeStats("nudge (all pts)", samples);
    results.push(stats);
    assertPerf(stats);
  });

  test("undo/redo — rapid after translate", async ({ page }) => {
    const contours = generateContourData(TARGET_POINTS);

    const samples = await page.evaluate(
      async ({ contours, sampleCount }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const pointIds = editor.selection.ids as readonly PointId[];
        const layer = editor.layerForGeometry({ points: pointIds });
        if (!layer) throw new Error("selected points have no editable layer");

        const updates = pointIds.map((id, index) => ({
          kind: "point" as const,
          id,
          x: index + 10,
          y: index + 10,
        }));
        layer.previewPositionPatch(updates);
        layer.applyPositionPatch(updates);
        await editor.font.editCoordinator.settled();

        const undoTimes: number[] = [];
        const redoTimes: number[] = [];

        for (let index = 0; index < sampleCount; index++) {
          const undoStart = performance.now();
          await editor.font.editCoordinator.undo();
          undoTimes.push(performance.now() - undoStart);

          const redoStart = performance.now();
          await editor.font.editCoordinator.redo();
          redoTimes.push(performance.now() - redoStart);
        }

        return { undo: undoTimes, redo: redoTimes };
      },
      { contours, sampleCount: UNDO_REDO_SAMPLES },
    );

    const undoStats = computeStats("undo (all pts)", samples.undo);
    const redoStats = computeStats("redo (all pts)", samples.redo);
    results.push(undoStats, redoStats);
    assertPerf(undoStats);
    assertPerf(redoStats);
  });

  test("pen tool — real clicks reach rendered geometry", async ({ page, editor }) => {
    await page.evaluate(async (contours) => {
      const editor = window.shift!.editor;
      const inserted = editor.insertContent({ contours });
      if (!inserted) throw new Error("contour insertion failed");

      await editor.font.editCoordinator.settled();
    }, generateContourData(TARGET_POINTS));
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

    const samples = await page.evaluate(
      async ({ contours, frames }) => {
        const editor = window.shift!.editor;
        const inserted = editor.insertContent({ contours });
        if (!inserted) throw new Error("contour insertion failed");

        await editor.font.editCoordinator.settled();
        editor.selectAll();

        const panTimes: number[] = [];
        const zoomTimes: number[] = [];

        for (let index = 0; index < frames; index++) {
          const panStart = performance.now();
          editor.setPan({ x: index * 10, y: index * 5 });
          panTimes.push(performance.now() - panStart);

          const zoomStart = performance.now();
          editor.zoomToPoint({ x: 640, y: 400 } as ScreenPoint, 0.01);
          zoomTimes.push(performance.now() - zoomStart);
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
