import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { PointAlignmentSnap } from "./PointAlignmentSnap";

describe("point alignment snaps each axis to the nearest stationary point", () => {
  const targets = [
    { x: 100, y: 300 },
    { x: 104, y: 50 },
  ];

  it("aligns x and y independently, each with its own target", () => {
    const snap = PointAlignmentSnap.to(targets, 8).snap({ x: 103, y: 296 });

    expect(snap?.x?.offset).toBe(1);
    expect(snap?.x?.guides).toEqual([
      { kind: "alignment", target: { x: 104, y: 50 }, point: { x: 104, y: 296 } },
    ]);
    expect(snap?.y?.offset).toBe(4);
    expect(snap?.y?.guides).toEqual([
      { kind: "alignment", target: { x: 100, y: 300 }, point: { x: 103, y: 300 } },
    ]);
  });

  it("leaves an axis free when no target is in range", () => {
    const snap = PointAlignmentSnap.to(targets, 8).snap({ x: 200, y: 296 });

    expect(snap?.x).toBeNull();
    expect(snap?.y?.offset).toBe(4);
  });

  it("returns nothing when no target is in range on either axis", () => {
    expect(PointAlignmentSnap.to(targets, 8).snap({ x: 200, y: 200 })).toBeNull();
  });

  it("marks a marked point on the snapped line, never one off it", () => {
    const snap = PointAlignmentSnap.to([{ x: 100, y: 0 }], 8)
      .marking([
        { x: 100, y: 500 },
        { x: 104, y: 500 },
      ])
      .snap({ x: 103, y: 300 });

    expect(snap?.x?.offset).toBe(-3);
    expect(snap?.x?.guides).toEqual([
      { kind: "alignment", target: { x: 100, y: 0 }, point: { x: 100, y: 300 } },
      { kind: "alignment", target: { x: 100, y: 500 }, point: { x: 100, y: 300 } },
    ]);
  });

  it("never snaps to a marked point on its own", () => {
    const snap = PointAlignmentSnap.to([], 8)
      .marking([{ x: 100, y: 300 }])
      .snap({ x: 102, y: 302 });

    expect(snap).toBeNull();
  });

  it("snaps as a scan of every target does, ties and their guide order included", () => {
    // Targets on a 5-unit grid tie on each axis; points halfway between grid lines are as near
    // a target on one side as on the other, where the first target given must win.
    let seed = 7;
    const next = () => ((seed = (seed * 48271) % 2147483647) % 40) * 5;
    const many: Point2D[] = Array.from({ length: 400 }, () => ({ x: next(), y: next() }));
    const snap = PointAlignmentSnap.to(many, 6);

    for (const point of Array.from({ length: 50 }, () => ({ x: next() + 2.5, y: next() - 2.5 }))) {
      expect(snap.snap(point)).toEqual(scanEveryTarget(many, 6, point));
    }
  });
});

/** The snap a scan of every target in order gives: nearest wins, equal offsets keep every guide. */
function scanEveryTarget(targets: readonly Point2D[], radius: number, point: Point2D) {
  const axis = (key: "x" | "y") => {
    let best: { offset: number; guides: object[] } | null = null;
    for (const target of targets) {
      const offset = target[key] - point[key];
      if (Math.abs(offset) > radius) continue;
      const aligned = key === "x" ? { x: target.x, y: point.y } : { x: point.x, y: target.y };
      const guide = { kind: "alignment", target, point: aligned };
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { offset, guides: [guide] };
      else if (offset === best.offset) best.guides.push(guide);
    }
    return best;
  };
  const x = axis("x");
  const y = axis("y");
  return x || y ? { x, y } : null;
}
