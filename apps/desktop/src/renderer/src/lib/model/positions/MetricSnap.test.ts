import { describe, expect, it } from "vitest";
import type { SourceMetrics } from "@shift/types";
import { MetricSnap } from "@shift/editor/model";

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

    expect(snap).toEqual({
      x: null,
      y: { offset: 4, guides: [{ kind: "metric", metric: "xHeight", x: 40, y: 500 }] },
    });
  });

  it("uses a non-zero authored baseline", () => {
    const snap = MetricSnap.standard(metrics, 8).snap({ x: 40, y: 4 });

    expect(snap?.y).toEqual({
      offset: 6,
      guides: [{ kind: "metric", metric: "baseline", x: 40, y: 10 }],
    });
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
    expect(snapping.snap({ x: 40, y: 496 })?.y?.offset).toBe(4);
  });

  it("only snaps over the lines' horizontal extent", () => {
    const snapping = MetricSnap.standard(metrics, 8).across({ minX: 0, maxX: 600 });

    expect(snapping.snap({ x: 300, y: 496 })?.y?.offset).toBe(4);
    expect(snapping.snap({ x: 700, y: 496 })).toBeNull();
    expect(snapping.snap({ x: -20, y: 496 })).toBeNull();
  });
});
