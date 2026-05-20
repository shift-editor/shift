/**
 * Rendering benchmarks — measure computation cost of each render pass.
 *
 * Uses a stubbed CanvasRenderingContext2D so all draw calls are no-ops.
 * This isolates the cost of glyph traversal, path construction, handle
 * classification, and bounding box computation.
 *
 * Key scenarios:
 * - SceneLayer — glyph outline + handles + control lines
 * - BackgroundLayer — guides + tool background
 * - OverlayLayer — tool overlays
 */

import { bench, describe } from "vitest";
import { createPointMark } from "@/testing/pointMark";
import { createStubCanvas } from "@/testing/stubCanvas";
import {
  BackgroundLayer,
  OverlayLayer,
  SceneLayer,
} from "@/lib/editor/rendering/RenderFrame";

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
  const background = new BackgroundLayer(pm.editor);
  const scene = new SceneLayer(pm.editor);
  const overlay = new OverlayLayer(pm.editor);

  describe(`rendering — ${label} points`, () => {
    bench("SceneLayer — no selection", () => {
      pm.editor.selection.clear();
      scene.draw(canvas);
    });

    bench("SceneLayer — all points selected", () => {
      pm.editor.selectAll();
      scene.draw(canvas);
    });

    bench("BackgroundLayer — no selection", () => {
      pm.editor.selection.clear();
      background.draw(canvas);
    });

    bench("BackgroundLayer — all points selected", () => {
      pm.editor.selectAll();
      background.draw(canvas);
    });

    bench("OverlayLayer — no selection", () => {
      pm.editor.selection.clear();
      overlay.draw(canvas);
    });

    bench("OverlayLayer — all points selected", () => {
      pm.editor.selectAll();
      overlay.draw(canvas);
    });
  });
}
