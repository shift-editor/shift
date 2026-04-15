/**
 * Rendering benchmarks — measure computation cost of each render pass.
 *
 * Uses a stubbed CanvasRenderingContext2D so all draw calls are no-ops.
 * This isolates the cost of glyph traversal, path construction, handle
 * classification, and bounding box computation.
 *
 * Key scenarios:
 * - renderToolScene — glyph outline + handles + control lines
 * - renderToolBackground — guides + bounding box
 * - renderOverlay — bounding box handles + snap lines
 */

import { bench, describe } from "vitest";
import { createPointMark } from "@/testing/pointMark";
import { createStubCanvas } from "@/testing/stubCanvas";

const canvas = createStubCanvas();

const pm1k = createPointMark(1_000);
pm1k.editor.selectTool("select");

const pm10k = createPointMark(10_000);
pm10k.editor.selectTool("select");

const pm50k = createPointMark(50_000);
pm50k.editor.selectTool("select");

const marks = [
  { label: "1K", pm: pm1k },
  { label: "10K", pm: pm10k },
  { label: "50K", pm: pm50k },
] as const;

for (const { label, pm } of marks) {
  describe(`rendering — ${label} points`, () => {
    bench("renderToolScene — no selection", () => {
      pm.editor.selection.clear();
      pm.editor.renderToolScene(canvas);
    });

    bench("renderToolScene — all points selected", () => {
      pm.editor.selectAll();
      pm.editor.renderToolScene(canvas);
    });

    bench("renderToolBackground — no selection", () => {
      pm.editor.selection.clear();
      pm.editor.renderToolBackground(canvas);
    });

    bench("renderToolBackground — all points selected", () => {
      pm.editor.selectAll();
      pm.editor.renderToolBackground(canvas);
    });

    bench("renderOverlay — no selection", () => {
      pm.editor.selection.clear();
      pm.editor.renderOverlay(canvas);
    });

    bench("renderOverlay — all points selected", () => {
      pm.editor.selectAll();
      pm.editor.renderOverlay(canvas);
    });
  });
}
