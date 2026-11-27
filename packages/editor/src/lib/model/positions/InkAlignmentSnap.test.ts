import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { InkAlignmentSnap } from "./InkAlignmentSnap";

describe("ink alignment snaps each axis to the nearest ink edge", () => {
  const targets = [
    { x: 80, y: 0 },
    { x: 120, y: 200 },
  ];

  it("aligns x and y independently, each with its own target", () => {
    const snap = InkAlignmentSnap.to(targets, 8).snap({ x: 82, y: 196 });

    expect(snap?.x?.offset).toBe(-2);
    expect(snap?.x?.guides).toEqual([
      { kind: "inkAlignment", target: { x: 80, y: 0 }, point: { x: 80, y: 196 } },
    ]);
    expect(snap?.y?.offset).toBe(4);
    expect(snap?.y?.guides).toEqual([
      { kind: "inkAlignment", target: { x: 120, y: 200 }, point: { x: 82, y: 200 } },
    ]);
  });

  it("leaves an axis free when no target is in range", () => {
    const snap = InkAlignmentSnap.to(targets, 8).snap({ x: 200, y: 196 });

    expect(snap?.x).toBeNull();
    expect(snap?.y?.offset).toBe(4);
  });

  it("returns nothing when no target is in range on either axis", () => {
    expect(InkAlignmentSnap.to(targets, 8).snap({ x: 200, y: 100 })).toBeNull();
  });

  it("emits inkAlignment guides, not alignment", () => {
    const snap = InkAlignmentSnap.to([{ x: 80, y: 0 }], 5).snap({ x: 82, y: 50 });

    expect(snap?.x?.guides[0]).toMatchObject({ kind: "inkAlignment" });
  });

  it("snaps as a scan of every target does, ties and their guide order included", () => {
    let seed = 7;
    const next = () => ((seed = (seed * 48271) % 2147483647) % 40) * 5;
    const many: Point2D[] = Array.from({ length: 400 }, () => ({ x: next(), y: next() }));
    const snap = InkAlignmentSnap.to(many, 6);

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
      const guide = { kind: "inkAlignment", target, point: aligned };
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { offset, guides: [guide] };
      else if (offset === best.offset) best.guides.push(guide);
    }
    return best;
  };
  const x = axis("x");
  const y = axis("y");
  return x || y ? { x, y } : null;
}
