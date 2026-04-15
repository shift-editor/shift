/**
 * Viewport manipulation benchmarks — pan and zoom at scale.
 *
 * Key scenarios:
 * - Continuous pan across N frames on a complex glyph
 * - Continuous zoom in/out across N frames
 * - Pan + zoom with active selection (all points selected)
 */

import { bench, describe } from "vitest";
import { createPointMark } from "@/testing/pointMark";

const pm1k = createPointMark(1_000);
const pm10k = createPointMark(10_000);
const pm50k = createPointMark(50_000);

const marks = [
  { label: "1K", pm: pm1k },
  { label: "10K", pm: pm10k },
  { label: "50K", pm: pm50k },
] as const;

for (const { label, pm } of marks) {
  describe(`viewport — ${label} points`, () => {
    bench("pan — single frame step", () => {
      const current = pm.editor.pan;
      pm.editor.setPan({ x: current.x + 10, y: current.y + 5 });
    });

    bench("zoom — single zoomToPoint step", () => {
      pm.editor.zoomToPoint(400, 300, 0.01);
    });

    bench("pan with all points selected", () => {
      pm.editor.selectAll();
      const current = pm.editor.pan;
      pm.editor.setPan({ x: current.x + 10, y: current.y + 5 });
      pm.editor.selection.clear();
    });

    bench("zoom with all points selected", () => {
      pm.editor.selectAll();
      pm.editor.zoomToPoint(400, 300, 0.01);
      pm.editor.selection.clear();
    });
  });
}
