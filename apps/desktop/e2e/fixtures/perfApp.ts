/**
 * Perf test fixture — launches Electron with GPU acceleration enabled.
 *
 * Unlike the snapshot fixture (LIBGL_ALWAYS_SOFTWARE=1), perf tests run with
 * the real GPU path so measurements reflect actual rendering performance.
 */

import {
  test as base,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { once } from "events";
import type { ContourContent } from "@shift/editor/clipboard";
import type { PointId } from "@shift/types";
import type { ContourFixture, PointFixture } from "@/testing/fixtures";
import { EditorDriver } from "./EditorDriver";
import { clearSelection } from "./editorInteractions";
import { copyImportedSource, createAuthoredDocument } from "./fontSource";
import type { RecordedDialog } from "./types";
import { registerApp } from "./appHooks";
import { buildFontFixture } from "./buildFontFixture";
import type { FontFixture } from "@/testing/fonts";

const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");
const EDITABLE_FONT_PATH =
  process.env.SHIFT_E2E_FONT_PATH ??
  path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
const PREVIEW_FONT_PATH =
  process.env.SHIFT_E2E_PREVIEW_FONT_PATH ??
  path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");
const VARIABLE_PREVIEW_FONT_PATH =
  process.env.SHIFT_E2E_VARIABLE_PREVIEW_FONT_PATH ??
  path.resolve(APP_ROOT, "src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf");
const UFO_PREVIEW_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo",
);
const ANCHOR_DRAG_FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/AnchorDragBench.glyphs");
const GLYPHS_PREVIEW_FONT_PATH =
  process.env.SHIFT_E2E_GLYPHS_PREVIEW_FONT_PATH ??
  path.resolve(APP_ROOT, "../../fixtures/fonts/MutatorSansVariable.glyphs");

/** Fixed CSS content size that fits the hosted macOS runner's available work area. */
const CONTENT_WIDTH = 1200;
const CONTENT_HEIGHT = 650;

export type PerfFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  editor: EditorDriver;
  sourcePath: string;
  /** What to build into the opened font before the test starts; nothing when unset. */
  font: FontFixture | undefined;
};

/**
 * Perf test fixture — GPU enabled, no software rendering override.
 */
function createAppTest(fontPath: string, prepareSource: typeof createAuthoredDocument) {
  return base.extend<PerfFixtures>({
    font: [undefined, { option: true }],

    electronApp: async ({}, use) => {
      const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-"));
      const userDataDir = path.join(testRoot, "user-data");
      const workspaceDirectory = path.join(testRoot, "workspace");
      const workspacePath = prepareSource(fontPath, workspaceDirectory);
      let app: ElectronApplication | null = null;

      try {
        app = await electron.launch({
          args: [MAIN_JS, `--user-data-dir=${userDataDir}`],
          env: {
            ...process.env,
            NODE_ENV: "test",
            SHIFT_E2E_FONT_PATH: workspacePath,
            // No LIBGL_ALWAYS_SOFTWARE — use real GPU for perf measurements.
          },
        });

        registerApp(app);
        const page = await app.firstWindow();
        // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron main and sizes the window, not app state
        const activeUserDataDir = await app.evaluate(({ app: electronApp }) =>
          electronApp.getPath("userData"),
        );
        if (fs.realpathSync(activeUserDataDir) !== fs.realpathSync(userDataDir)) {
          throw new Error(`Electron ignored isolated user data directory: ${activeUserDataDir}`);
        }

        const contentSize = { width: CONTENT_WIDTH, height: CONTENT_HEIGHT };
        const browserWindow = await app.browserWindow(page);
        await browserWindow.evaluate((win, { width, height }) => {
          win.unmaximize();
          win.setContentSize(width, height);
          win.center();
        }, contentSize);
        // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron main and sizes the window, not app state
        await page.waitForFunction(
          ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
          contentSize,
        );
        // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron main and sizes the window, not app state
        await page.waitForFunction(() => document.visibilityState === "visible");
        await browserWindow.evaluate((win, { width, height }) => {
          win.setContentSize(width, height);
          win.center();
        }, contentSize);
        await browserWindow.dispose();
        // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron main and sizes the window, not app state
        await page.waitForFunction(
          ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
          contentSize,
        );

        await use(app);
      } finally {
        const childProcess = app?.process();
        if (childProcess && childProcess.exitCode === null && childProcess.signalCode === null) {
          const exited = once(childProcess, "exit");
          childProcess.kill("SIGKILL");
          await exited;
        }
        fs.rmSync(testRoot, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    },

    sourcePath: async ({ electronApp }, use) => {
      // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron main and sizes the window, not app state
      const sourcePath = await electronApp.evaluate(() => process.env.SHIFT_E2E_FONT_PATH ?? null);
      if (!sourcePath) throw new Error("E2E font source path is unavailable");

      await use(sourcePath);
    },

    page: async ({ electronApp, font }, use) => {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForURL(/#\/home/, { timeout: 20_000 });
      if (font) await buildFontFixture(page, electronApp, font);

      const dialogs: RecordedDialog[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        await dialog.dismiss();
      });

      await use(page);

      if (dialogs.length > 0) {
        throw new Error(`Unexpected renderer dialogs: ${JSON.stringify(dialogs)}`);
      }
    },

    editor: async ({ page, electronApp }, use) => {
      await use(new EditorDriver(page, electronApp));
    },
  });
}

export const test = createAppTest(EDITABLE_FONT_PATH, createAuthoredDocument);
export const previewTest = createAppTest(PREVIEW_FONT_PATH, copyImportedSource);
export const variablePreviewTest = createAppTest(VARIABLE_PREVIEW_FONT_PATH, copyImportedSource);
export const designspacePreviewTest = createAppTest(EDITABLE_FONT_PATH, copyImportedSource);
export const ufoPreviewTest = createAppTest(UFO_PREVIEW_FONT_PATH, copyImportedSource);
export const glyphsPreviewTest = createAppTest(GLYPHS_PREVIEW_FONT_PATH, copyImportedSource);
/** Authored `AnchorDragBench`: `a`–`z`, combining marks, and composites on `u`. */
export const anchorDragTest = createAppTest(ANCHOR_DRAG_FONT_PATH, createAuthoredDocument);

export { expect } from "./matchers";

/**
 * MutatorSans "S" contour data (44 points) for generating 50K-point glyphs.
 * Same data used in the engine-layer benchmarks (testing/pointMark.ts).
 */
const MUTATORSANS_S = [
  { x: 349, y: 157, pointType: "onCurve", smooth: true },
  { x: 348, y: 238, pointType: "offCurve", smooth: false },
  { x: 299, y: 293, pointType: "offCurve", smooth: false },
  { x: 217, y: 358, pointType: "onCurve", smooth: true },
  { x: 167, y: 398, pointType: "onCurve", smooth: true },
  { x: 105, y: 447, pointType: "offCurve", smooth: false },
  { x: 84, y: 494, pointType: "offCurve", smooth: false },
  { x: 84, y: 557, pointType: "onCurve", smooth: true },
  { x: 84, y: 619, pointType: "offCurve", smooth: false },
  { x: 128, y: 673, pointType: "offCurve", smooth: false },
  { x: 211, y: 673, pointType: "onCurve", smooth: true },
  { x: 219, y: 673, pointType: "onCurve", smooth: true },
  { x: 268, y: 673, pointType: "offCurve", smooth: false },
  { x: 308, y: 664, pointType: "offCurve", smooth: false },
  { x: 348, y: 640, pointType: "onCurve", smooth: false },
  { x: 365, y: 677, pointType: "onCurve", smooth: false },
  { x: 328, y: 696, pointType: "offCurve", smooth: false },
  { x: 291, y: 711, pointType: "offCurve", smooth: false },
  { x: 229, y: 711, pointType: "onCurve", smooth: true },
  { x: 222, y: 711, pointType: "onCurve", smooth: true },
  { x: 104, y: 711, pointType: "offCurve", smooth: false },
  { x: 45, y: 639, pointType: "offCurve", smooth: false },
  { x: 46, y: 544, pointType: "onCurve", smooth: true },
  { x: 47, y: 463, pointType: "offCurve", smooth: false },
  { x: 90, y: 406, pointType: "offCurve", smooth: false },
  { x: 172, y: 341, pointType: "onCurve", smooth: true },
  { x: 222, y: 301, pointType: "onCurve", smooth: true },
  { x: 293, y: 244, pointType: "offCurve", smooth: false },
  { x: 311, y: 207, pointType: "offCurve", smooth: false },
  { x: 311, y: 144, pointType: "onCurve", smooth: true },
  { x: 311, y: 82, pointType: "offCurve", smooth: false },
  { x: 267, y: 28, pointType: "offCurve", smooth: false },
  { x: 184, y: 28, pointType: "onCurve", smooth: true },
  { x: 176, y: 28, pointType: "onCurve", smooth: true },
  { x: 123.2, y: 28, pointType: "offCurve", smooth: false },
  { x: 80.35, y: 37.99, pointType: "offCurve", smooth: false },
  { x: 37, y: 64, pointType: "onCurve", smooth: false },
  { x: 20, y: 27, pointType: "onCurve", smooth: false },
  { x: 59.91, y: 6.5, pointType: "offCurve", smooth: false },
  { x: 99.44, y: -10, pointType: "offCurve", smooth: false },
  { x: 166, y: -10, pointType: "onCurve", smooth: true },
  { x: 173, y: -10, pointType: "onCurve", smooth: true },
  { x: 291, y: -10, pointType: "offCurve", smooth: false },
  { x: 350, y: 62, pointType: "offCurve", smooth: false },
] as const;

const POINTS_PER_CONTOUR = MUTATORSANS_S.length; // 44

/**
 * Generate contour data for N target points by duplicating the S contour
 * on a grid. Returns serializable data that can be passed into page.evaluate().
 */
export function generateContourData(targetPoints: number) {
  const count = Math.ceil(targetPoints / POINTS_PER_CONTOUR);
  const cols = Math.ceil(Math.sqrt(count));
  const contours: ContourContent[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const offsetX = col * 500;
    const offsetY = row * 800;

    const points = MUTATORSANS_S.map((p) => ({
      x: p.x + offsetX,
      y: p.y + offsetY,
      pointType: p.pointType,
      smooth: p.smooth,
    }));

    contours.push({ points, closed: true });
  }

  return contours;
}

/** {@link generateContourData}'s contours as glyph fixtures, for {@link EditorDriver.draw}. */
export function benchmarkContours(targetPoints: number): ContourFixture[] {
  return generateContourData(targetPoints).map((contour) => ({
    closed: contour.closed,
    points: contour.points.map((point): PointFixture => {
      // oxlint-disable-next-line shift/no-raw-point-type-check -- generated benchmark data in the test process, where @shift/glyph-state does not load
      if (point.pointType === "offCurve") return { x: point.x, y: point.y, off: true };
      return point.smooth ? { x: point.x, y: point.y, smooth: true } : [point.x, point.y];
    }),
  }));
}

/**
 * Draws {@link benchmarkContours} into the open glyph and returns its point ids in drawing
 * order, leaving nothing selected, as pasting them would.
 */
export async function drawBenchmarkGlyph(
  editor: EditorDriver,
  targetPoints: number,
): Promise<PointId[]> {
  await editor.draw({ contours: benchmarkContours(targetPoints) }, { select: true });
  const ids = [...(await editor.selectionIds())] as PointId[];
  await clearSelection(editor.page);
  return ids;
}

export interface PerfResult {
  label: string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

const smallestFirst = (a: number, b: number) => a - b;

/**
 * Compute percentile stats from an array of timing samples.
 */
export function computeStats(label: string, samples: number[]): PerfResult {
  const sorted = samples.toSorted(smallestFirst);
  const p = (pct: number) => sorted[Math.floor(sorted.length * pct)] ?? 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  return { label, samples, p50: p(0.5), p95: p(0.95), p99: p(0.99), mean };
}

/**
 * Format perf results into a readable table string for test output.
 */
export function formatPerfTable(results: PerfResult[]): string {
  const header = "| Operation | Samples | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) |";
  const separator = "|---|---|---|---|---|---|";
  const rows = results.map(
    (r) =>
      `| ${r.label} | ${r.samples.length} | ${r.p50.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.p99.toFixed(2)} | ${r.mean.toFixed(2)} |`,
  );
  return [header, separator, ...rows].join("\n");
}
