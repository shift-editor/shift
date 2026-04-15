/**
 * NAPI boundary benchmarks — measure the cost of crossing JS/Rust.
 *
 * Key scenarios:
 * - bridge.sync(positionUpdates) — Float64Array fast path for position-only updates
 * - bridge.sync(snapshot) — full JSON round-trip for structural changes
 * - bridge.setNodePositions — individual struct marshaling
 * - bridge.getSnapshot — reading full glyph state back from Rust
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
    bench("bridge.sync — position updates (all points)", () => {
      const updates = buildPositionUpdates(pm.pointIds, 1, 1);
      pm.editor.bridge.sync(updates);
    });

    bench("bridge.sync — position updates (single point)", () => {
      const updates = buildPositionUpdates([pm.pointIds[0]], 1, 1);
      pm.editor.bridge.sync(updates);
    });

    bench("bridge.sync — full snapshot round-trip", () => {
      const snapshot = pm.editor.bridge.getEditingSnapshot()!;
      pm.editor.bridge.sync(snapshot);
    });

    bench("bridge.getSnapshot", () => {
      pm.editor.bridge.getEditingSnapshot();
    });

    bench("bridge.setNodePositions — all points", () => {
      const updates = buildPositionUpdates(pm.pointIds, 1, 1);
      pm.editor.bridge.setNodePositions(updates);
    });

    bench("bridge.setNodePositions — single point", () => {
      const updates = buildPositionUpdates([pm.pointIds[0]], 1, 1);
      pm.editor.bridge.setNodePositions(updates);
    });
  });
}
