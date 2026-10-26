/**
 * What the window's editing engine costs per edit, on a small font and on a
 * CJK-sized one (`SHIFT_E2E_CJK_FONT_PATH`, Noto Sans CJK SC; skipped unset).
 *
 * Each sample reads the engine's own `performance` measures (`engine.apply`,
 * `engine.preview`, `engine.endEdit`, `engine.undo`, `engine.redo`) beside the
 * wall time around them:
 *
 * - **apply**: one point nudge outside a transaction, applied in the engine.
 * - **frame**: from that edit to the second animation frame after it, by which
 *   point the browser has painted the frame showing it.
 * - **persist**: from an edit until the workspace has written it.
 * - **preview per frame**: a whole-glyph scale previewed by the engine on each
 *   frame, as the transform box does, then committed once.
 * - **coalesce**: 60 nudges in one transaction, closed as one change set.
 * - **undo / redo**: engine replay, and the round trip until it is persisted.
 * - **unopened glyph rename**: a rename replaces the glyph whole, so the engine
 *   first loads every layer of a glyph the window has not opened.
 *
 * Measurements only: no ceilings or baseline yet. Reports go to `perf-results/`.
 */
import * as fs from "fs";
import * as path from "path";
import type { GlyphId, GlyphName, PointId, Unicode } from "@shift/types";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  CJK_FONT_PATH,
  cjkTest,
  computeStats,
  expect,
  formatPerfTable,
  test,
  type PerfResult,
} from "./fixtures/perfApp";

const RESULTS_DIR = path.resolve(__dirname, "perf-results");
const WARMUP = 5;
const NUDGES = 40;
const PERSISTS = 10;
const PREVIEW_FRAMES = 60;
const COALESCED_NUDGES = 60;
const COALESCE_SAMPLES = 5;
const UNDO_SAMPLES = 10;
const RENAMES = 10;

interface EngineSamples {
  readonly [label: string]: number[];
}

/** Opens the glyph for `unicode` and samples every scenario in the renderer. */
async function sampleEngine(editor: EditorDriver, unicode: string): Promise<EngineSamples> {
  await editor.openGlyphByUnicode(unicode);
  await editor.waitForIdle();
  await editor.waitForCanvasRender();

  return editor.page.evaluate(
    async (counts) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("shift runtime API not exposed");
      const { editor: runtime, font } = workspace;
      const coordinator = font.editCoordinator;
      const samples: Record<string, number[]> = {};
      const record = (label: string, values: readonly number[]) => {
        (samples[label] ??= []).push(...values);
      };
      /** Durations of `name` measured since the last call, then forgets them. */
      const measured = (name: string): number[] => {
        const durations = performance
          .getEntriesByName(name, "measure")
          .map((entry) => entry.duration);
        performance.clearMeasures(name);
        return durations;
      };
      const painted = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

      runtime.selectAll();
      const pointId = runtime.selection.ids[0] as PointId | undefined;
      if (!pointId) throw new Error("the glyph has no points to nudge");
      const layer = runtime.layerForGeometry({ points: [pointId] });
      if (!layer) throw new Error("the point has no editable layer");
      await coordinator.settled();
      for (const name of ["engine.apply", "engine.preview", "engine.endEdit"]) measured(name);

      for (let index = -counts.warmup; index < counts.nudges; index++) {
        const start = performance.now();
        layer.movePoints([pointId], { x: 1, y: 0 });
        const applied = performance.now() - start;
        await painted();
        const frame = performance.now() - start;
        const engine = measured("engine.apply");
        if (index < 0) continue;
        record("nudge: wall, sync", [applied]);
        record("nudge: engine.apply", engine);
        record("nudge: edit to painted frame", [frame]);
      }
      await coordinator.settled();
      measured("engine.endEdit");

      for (let index = 0; index < counts.persists; index++) {
        const start = performance.now();
        layer.movePoints([pointId], { x: 0, y: 1 });
        await coordinator.settled();
        record("nudge: edit to persisted", [performance.now() - start]);
      }
      measured("engine.apply");
      measured("engine.endEdit");

      const transform = layer.beginTransformEdit({
        origin: { x: 0, y: 0 },
        keepRightSidebearing: false,
        transformedGlyphIds: new Set(),
      });
      for (let index = -counts.warmup; index < counts.previewFrames; index++) {
        const scale = 1 + (index + counts.warmup + 1) * 0.001;
        const start = performance.now();
        transform.preview({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
        const previewed = performance.now() - start;
        await painted();
        const frame = performance.now() - start;
        const engine = measured("engine.preview");
        if (index < 0) continue;
        record("scale preview: wall, sync", [previewed]);
        record("scale preview: engine.preview", engine);
        record("scale preview: frame to painted", [frame]);
      }
      const commitStart = performance.now();
      transform.commit();
      record("scale commit: wall, sync", [performance.now() - commitStart]);
      record("scale commit: engine.endEdit", measured("engine.endEdit"));
      await coordinator.settled();
      record("scale commit: to persisted", [performance.now() - commitStart]);
      measured("engine.apply");

      for (let sample = 0; sample < counts.coalesceSamples; sample++) {
        const start = performance.now();
        coordinator.transaction("Engine perf nudges", () => {
          for (let index = 0; index < counts.coalescedNudges; index++) {
            layer.movePoints([pointId], { x: 1, y: 0 });
          }
        });
        record("60 nudges in one edit: wall, sync", [performance.now() - start]);
        record("60 nudges in one edit: engine.apply each", measured("engine.apply"));
        record("60 nudges in one edit: engine.endEdit (coalesce)", measured("engine.endEdit"));
        await coordinator.settled();
      }

      measured("engine.undo");
      measured("engine.redo");
      for (let index = 0; index < counts.undoSamples; index++) {
        const undoStart = performance.now();
        await coordinator.undo();
        record("undo: to persisted", [performance.now() - undoStart]);
        const redoStart = performance.now();
        await coordinator.redo();
        record("redo: to persisted", [performance.now() - redoStart]);
      }
      record("undo: engine.undo", measured("engine.undo"));
      record("redo: engine.redo", measured("engine.redo"));

      // Glyphs from the middle of the font, which the window has not opened.
      const entries = font.glyphEntries();
      const middle = Math.floor(entries.length / 2);
      const unopened = entries.slice(middle, middle + counts.renames);
      measured("engine.apply");
      for (const entry of unopened) {
        const start = performance.now();
        font.updateGlyphIdentity(
          entry.id as GlyphId,
          `${entry.name}.perf` as GlyphName,
          entry.unicodes as Unicode[],
        );
        record("unopened glyph rename: wall, sync", [performance.now() - start]);
        await coordinator.settled();
        record("unopened glyph rename: to persisted", [performance.now() - start]);
      }
      record("unopened glyph rename: engine.apply", measured("engine.apply"));
      record("glyph count", [entries.length]);

      return samples;
    },
    {
      warmup: WARMUP,
      nudges: NUDGES,
      persists: PERSISTS,
      previewFrames: PREVIEW_FRAMES,
      coalescedNudges: COALESCED_NUDGES,
      coalesceSamples: COALESCE_SAMPLES,
      undoSamples: UNDO_SAMPLES,
      renames: RENAMES,
    },
  );
}

/** Writes the samples as a table to `perf-results/` and the log, keyed by `fontLabel`. */
function report(fontLabel: string, samples: EngineSamples): PerfResult[] {
  const glyphCount = samples["glyph count"]?.[0] ?? 0;
  const results = Object.entries(samples)
    .filter(([label]) => label !== "glyph count")
    .map(([label, values]) => computeStats(`${fontLabel}: ${label}`, values));
  const table = formatPerfTable(results);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = fontLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  fs.writeFileSync(
    path.join(RESULTS_DIR, `engine-${slug}-${timestamp}.md`),
    [`# Engine perf — ${fontLabel} (${glyphCount} glyphs)`, "", table, ""].join("\n"),
  );
  console.log(`\n${fontLabel} (${glyphCount} glyphs)\n${table}`);
  return results;
}

test.describe("Engine edit costs", () => {
  test.describe.configure({ timeout: 600_000 });

  test("MutatorSans", async ({ editor }) => {
    const results = report("MutatorSans", await sampleEngine(editor, "53"));
    expect(results.length).toBeGreaterThan(0);
  });
});

cjkTest.describe("Engine edit costs on a CJK-sized font", () => {
  cjkTest.describe.configure({ timeout: 900_000 });
  cjkTest.skip(CJK_FONT_PATH === null, "SHIFT_E2E_CJK_FONT_PATH is not set");

  // U+9B31 鬱, one of the font's most complex outlines.
  cjkTest("Noto Sans CJK SC", async ({ editor }) => {
    const results = report("Noto Sans CJK SC", await sampleEngine(editor, "9b31"));
    expect(results.length).toBeGreaterThan(0);
  });
});
