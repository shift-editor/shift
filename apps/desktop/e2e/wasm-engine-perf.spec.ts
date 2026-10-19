/**
 * SPIKE: cost of running shift-font's apply_intents as a renderer-resident
 * WASM engine, against today's TypeScript local apply, on a real font.
 *
 * Each sample reverses one contour through the model (the same call the Pen
 * tool and contour joining make), then measures:
 * - **local**: synchronous main-thread time of the edit (engine apply or TS
 *   buffers, plus publishing the new layer state);
 * - **frame**: until the next frame after the edit has painted;
 * - **settled**: until the native workspace has echoed the edit.
 *
 * Memory is read from Electron's per-process metrics and the engine's wasm memory.
 */
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { FONT_PATH, workspaceTest as test, expect } from "./fixtures/electronApp";

test.use({ startupFontPath: process.env.SPIKE_FONT ?? FONT_PATH });

const SAMPLES = Number(process.env.SPIKE_SAMPLES ?? 20);
const CODEPOINT = process.env.SPIKE_CODEPOINT ?? "6C38"; // 永
const RESULTS = path.resolve(__dirname, "perf-results");

async function measure(page: Page, samples: number) {
  return page.evaluate(async (count) => {
    const workspace = window.shift;
    const editor = workspace?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!workspace || !layer) throw new Error("Expected an authored layer");

    const contourId = layer.contours[0]!.id;
    const nextPaint = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const rows: { local: number; frame: number; settled: number }[] = [];
    for (let i = 0; i < count; i++) {
      await workspace.font.editCoordinator.settled();
      const start = performance.now();
      layer.reverseContour(contourId);
      const local = performance.now() - start;
      await nextPaint();
      const frame = performance.now() - start;
      await workspace.font.editCoordinator.settled();
      const settled = performance.now() - start;
      rows.push({ local, frame, settled });
    }
    const engine = (globalThis as { __shiftEngine?: { timings: object; memory: () => object } })
      .__shiftEngine;
    return {
      rows,
      points: layer.contours.reduce((sum, contour) => sum + contour.points.length, 0),
      glyphs: workspace.font.glyphRecords.length,
      engine: engine ? { timings: { ...engine.timings }, memory: engine.memory() } : null,
    };
  }, samples);
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    mean: +mean.toFixed(2),
    p50: +sorted[Math.floor(sorted.length / 2)]!.toFixed(2),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!.toFixed(2),
  };
}

for (const mode of ["typescript", "wasm-engine"] as const) {
  test(`reverse contour on a real font — ${mode}`, async ({ page, editor, electronApp }) => {
    test.setTimeout(600_000);
    await page.evaluate((on) => {
      if (on) localStorage.setItem("shift.wasmEngine", "1");
      else localStorage.removeItem("shift.wasmEngine");
    }, mode === "wasm-engine");
    // The flag is read when the workspace opens; reload so it opens again with it.
    await page.reload();
    await page.waitForURL(/#\/home/, { timeout: 60_000 });
    await editor.openGlyphByUnicode(CODEPOINT);

    const result = await measure(page, SAMPLES);
    const metrics = await electronApp.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((m) => ({
          type: m.type,
          name: m.name,
          workingSetMb: Math.round(m.memory.workingSetSize / 1024),
        })),
    );
    const report = {
      mode,
      font: path.basename(process.env.SPIKE_FONT ?? FONT_PATH),
      glyphs: result.glyphs,
      layerPoints: result.points,
      local: stats(result.rows.map((r) => r.local)),
      frame: stats(result.rows.map((r) => r.frame)),
      settled: stats(result.rows.map((r) => r.settled)),
      engine: result.engine,
      processes: metrics,
    };
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(
      path.join(RESULTS, `wasm-engine-${mode}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (mode === "wasm-engine") expect(result.engine?.timings).toBeTruthy();
  });
}
