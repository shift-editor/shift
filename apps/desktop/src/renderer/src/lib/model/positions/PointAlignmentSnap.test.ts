import { describe, expect, it } from "vitest";
import { PointAlignmentSnap } from "@shift/editor/model";

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
});
