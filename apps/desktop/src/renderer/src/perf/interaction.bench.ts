/**
 * Full-pipeline interaction benchmarks — simulate real drag operations
 * through the tool system (hit test -> state machine -> snap -> draft).
 *
 * These measure what actually happens during a user drag:
 * - pointerDown: hit-test + selection + draft creation + snap session
 * - pointerMove (per frame): snap resolution + build updates + draft.setPositions
 * - pointerUp: draft.finish + undo recording
 *
 * Contrast with pointManipulation.bench.ts which calls createDraft/setPositions
 * directly and skips the tool overhead.
 */

import { bench, describe } from "vitest";
import { createPointMark, type PointScale } from "@/testing/pointMark";

const DRAG_FRAMES = 30;

function setupDrag(scale: PointScale) {
  const pm = createPointMark(scale);
  pm.editor.selectTool("select");

  const glyph = pm.editor.currentGlyph!;
  const firstPoint = glyph.allPoints[0];
  const startX = firstPoint.x;
  const startY = firstPoint.y;

  return { pm, startX, startY };
}

const s1k = setupDrag(1_000);
const s10k = setupDrag(10_000);
const s50k = setupDrag(50_000);

const setups = [
  { label: "1K", s: s1k },
  { label: "10K", s: s10k },
  { label: "50K", s: s50k },
] as const;

for (const { label, s } of setups) {
  describe(`translate drag — ${label} points`, () => {
    bench("single point — 30-frame drag", () => {
      const { pm, startX, startY } = s;
      pm.editor.selection.clear();

      // Click to select the point, then drag it
      pm.editor.click(startX, startY);
      pm.editor.pointerDown(startX, startY);
      for (let i = 1; i <= DRAG_FRAMES; i++) {
        pm.editor.pointerMove(startX + i, startY + i);
      }
      pm.editor.pointerUp(startX + DRAG_FRAMES, startY + DRAG_FRAMES);
    });

    bench("all points selected — 30-frame drag", () => {
      const { pm, startX, startY } = s;
      pm.editor.selectAll();

      pm.editor.pointerDown(startX, startY);
      for (let i = 1; i <= DRAG_FRAMES; i++) {
        pm.editor.pointerMove(startX + i, startY + i);
      }
      pm.editor.pointerUp(startX + DRAG_FRAMES, startY + DRAG_FRAMES);
    });

    bench("per-frame cost — pointerMove during drag (all selected)", () => {
      const { pm, startX, startY } = s;
      pm.editor.selectAll();

      // Start drag once outside the measured loop
      pm.editor.pointerDown(startX, startY);
      pm.editor.pointerMove(startX + 5, startY + 5);

      // Measure a single frame step
      pm.editor.pointerMove(startX + 6, startY + 6);

      pm.editor.pointerUp(startX + 6, startY + 6);
    });
  });
}
