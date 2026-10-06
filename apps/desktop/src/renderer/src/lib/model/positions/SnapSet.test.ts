import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { SourceMetrics } from "@shift/types";
import { MetricSnap, SnapSet } from "@shift/editor/model";

const metrics: SourceMetrics = {
  unitsPerEm: 1000,
  metricValues: [],
  ascender: 800,
  descender: -200,
  baseline: 0,
  xHeight: 500,
  capHeight: 700,
};

/** A vertical snap line: corrects x only. */
const verticalAt = (x: number) => ({
  snap: (point: Point2D) => ({
    x: { offset: x - point.x, guides: [] },
    y: null,
  }),
});

describe("snap sets choose the nearest correction per axis", () => {
  it("prefers the nearer provider regardless of order", () => {
    const far = MetricSnap.standard({ ...metrics, xHeight: 510 }, 20);
    const near = MetricSnap.standard(metrics, 20);

    const snap = SnapSet.nearest([far, near]).snap({ x: 0, y: 502 });

    expect(snap?.y?.offset).toBe(-2);
    expect(snap?.y?.guides).toEqual([{ kind: "metric", metric: "xHeight", x: 0, y: 500 }]);
  });

  it("snaps x and y from different providers in one frame", () => {
    const snap = SnapSet.nearest([MetricSnap.standard(metrics, 8), verticalAt(100)]).snap({
      x: 97,
      y: 703,
    });

    expect(snap?.x?.offset).toBe(3);
    expect(snap?.y?.offset).toBe(-3);
  });

  it("merges guides from providers that agree on a correction", () => {
    const shared = MetricSnap.standard(metrics, 8);
    const coincident = MetricSnap.standard({ ...metrics, capHeight: 500, xHeight: undefined }, 8);

    const snap = SnapSet.nearest([shared, coincident]).snap({ x: 0, y: 498 });

    expect(snap?.y?.guides).toEqual([
      { kind: "metric", metric: "xHeight", x: 0, y: 500 },
      { kind: "metric", metric: "capHeight", x: 0, y: 500 },
    ]);
  });

  it("returns nothing when no provider is in range", () => {
    expect(SnapSet.nearest([MetricSnap.standard(metrics, 4)]).snap({ x: 0, y: 300 })).toBeNull();
  });
});
