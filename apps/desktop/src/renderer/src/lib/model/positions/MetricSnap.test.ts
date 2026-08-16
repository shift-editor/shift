import { describe, expect, it } from "vitest";
import type { SourceMetrics } from "@shift/types";
import { MetricSnap } from "./MetricSnap";

const metrics: SourceMetrics = {
  unitsPerEm: 1000,
  metricValues: [],
  ascender: 800,
  descender: -200,
  baseline: 10,
  xHeight: 500,
  capHeight: 700,
};

describe("metric snapping follows authored horizontal metrics", () => {
  it("returns the nearest metric inside the radius", () => {
    const snap = MetricSnap.standard(metrics, 8).snap({ x: 40, y: 496 });

    expect(snap?.point).toEqual({ x: 40, y: 500 });
    expect(snap?.distance).toBe(4);
    expect(snap?.guides).toEqual([{ kind: "metric", metric: "xHeight", y: 500 }]);
  });

  it("uses a non-zero authored baseline", () => {
    const snap = MetricSnap.standard(metrics, 8).snap({ x: 40, y: 4 });

    expect(snap?.point).toEqual({ x: 40, y: 10 });
    expect(snap?.guides[0]).toEqual({ kind: "metric", metric: "baseline", y: 10 });
  });

  it("does not fabricate absent optional metrics at zero", () => {
    const sparse = { ...metrics, xHeight: undefined, capHeight: undefined };
    const snap = MetricSnap.standard(sparse, 2).snap({ x: 40, y: 0 });

    expect(snap).toBeNull();
  });

  it("honors its per-frame activation condition", () => {
    let enabled = false;
    const snapping = MetricSnap.standard(metrics, 8, { when: () => enabled });

    expect(snapping.snap({ x: 40, y: 496 })).toBeNull();
    enabled = true;
    expect(snapping.snap({ x: 40, y: 496 })?.point.y).toBe(500);
  });
});
