/**
 * Point manipulation benchmarks — draft translate, nudge at scale.
 *
 * Key scenarios from the perf ticket:
 * - Single point drag (1 changed / N total) — catches O(glyph) vs O(change)
 * - Select-all drag (N changed / N total) — NAPI boundary + rendering throughput
 * - Rapid nudge — command path overhead
 * - Draft discard (Escape) — JS-only restore cost
 */

import { bench, describe } from "vitest";
import { createPointMark, buildPositionUpdates } from "@/testing/pointMark";

const pm1k = createPointMark(1_000);
const pm10k = createPointMark(10_000);
const pm50k = createPointMark(50_000);

const marks = [
  { label: "1K", pm: pm1k },
  { label: "10K", pm: pm10k },
  { label: "50K", pm: pm50k },
] as const;

for (const { label, pm } of marks) {
  describe(`point manipulation — ${label} points`, () => {
    bench("draft.previewPositions — single point", () => {
      const draft = pm.editor.beginSourceEditDraft({ points: [pm.pointIds[0]] });
      const updates = buildPositionUpdates([pm.pointIds[0]], 1, 1);
      draft.previewPositions(updates);
      draft.discard();
    });

    bench("draft.previewPositions — all points", () => {
      const draft = pm.editor.beginSourceEditDraft({ points: pm.pointIds });
      const updates = buildPositionUpdates(pm.pointIds, 1, 1);
      draft.previewPositions(updates);
      draft.discard();
    });

    bench("draft.commit — single point", () => {
      const draft = pm.editor.beginSourceEditDraft({ points: [pm.pointIds[0]] });
      const updates = buildPositionUpdates([pm.pointIds[0]], 1, 1);
      draft.previewPositions(updates);
      draft.commit("bench move");
    });

    bench("draft.commit — all points", () => {
      const draft = pm.editor.beginSourceEditDraft({ points: pm.pointIds });
      const updates = buildPositionUpdates(pm.pointIds, 1, 1);
      draft.previewPositions(updates);
      draft.commit("bench move");
    });

    bench("draft.discard — after all-points update", () => {
      const draft = pm.editor.beginSourceEditDraft({ points: pm.pointIds });
      const updates = buildPositionUpdates(pm.pointIds, 5, 5);
      draft.previewPositions(updates);
      draft.discard();
    });

    bench("nudgePoints — single point", () => {
      pm.editor.nudgePoints([pm.pointIds[0]], 1, 0);
    });

    bench("nudgePoints — all points", () => {
      pm.editor.nudgePoints(pm.pointIds, 1, 0);
    });
  });
}
