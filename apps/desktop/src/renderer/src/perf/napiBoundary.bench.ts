/**
 * NAPI boundary benchmarks — measure the cost of crossing JS/Rust.
 *
 * Key scenarios:
 * - source.applyPositionPatch — local sparse patch + native sparse commit
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
  describe(`NAPI boundary — ${label} points`, () => {
    bench("source.applyPositionPatch — all points", () => {
      const updates = buildPositionUpdates(pm.pointIds, 1, 1);
      pm.editor.currentEdit!.applyPositionPatch(updates);
    });

    bench("source.applyPositionPatch — single point", () => {
      const updates = buildPositionUpdates([pm.pointIds[0]], 1, 1);
      pm.editor.currentEdit!.applyPositionPatch(updates);
    });
  });
}
