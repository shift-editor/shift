import { describe, expect, it } from "vitest";
import { Contour } from "@shift/glyph-state";
import { asContourId, asPointId, type PointType } from "@shift/types";
import { ShiftStore } from "../../../../store/ShiftStore";
import type { ShiftEditorRecord } from "../../../../../types/records";
import { Hover } from "../../../Hover";
import { Selection } from "../../../Selection";
import { HandleItems, type HandleStateSource } from "./HandleItems";

type PointSpec = readonly [x: number, y: number, pointType?: PointType];

/** An authored contour whose points are named `p0`, `p1`, … in order. */
function contour(points: readonly PointSpec[], closed = false): Contour {
  return new Contour(
    {
      id: asContourId("contour"),
      closed,
      points: points.map(([, , pointType = "onCurve"], index) => ({
        id: asPointId(`p${index}`),
        pointType,
        smooth: false,
      })),
    },
    new Float64Array(points.flatMap(([x, y]) => [x, y])),
    0,
  );
}

function positions(path: Contour): { id: string; x: number; y: number }[] {
  return path.points.map(({ id, x, y }) => ({ id, x, y }));
}

function stateSource(extra: Partial<HandleStateSource> = {}): HandleStateSource {
  return {
    selection: new Selection(new ShiftStore<ShiftEditorRecord>()),
    hover: new Hover(),
    ...extra,
  };
}

describe("handle culling preserves authored neighbors and visibility", () => {
  it("does not turn a viewport's first visible point into a contour endpoint", () => {
    const path = contour([
      [100, 100],
      [200, 150],
      [300, 100],
    ]);
    const list = new HandleItems().fromContours([path], stateSource(), undefined, {
      min: { x: 190, y: 140 },
      max: { x: 210, y: 160 },
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.point.id).toBe(path.points[1]!.id);
    expect(list.items[0]!.shape).toBe("corner");
    expect(list.items[0]!.prev?.id).toBe(path.points[0]!.id);
    expect(list.items[0]!.next?.id).toBe(path.points[2]!.id);
  });

  it("keeps boundary endpoints and their direction toward offscreen neighbors", () => {
    const path = contour([
      [100, 100],
      [200, 200],
    ]);
    const list = new HandleItems().fromContours([path], stateSource(), undefined, {
      min: { x: 100, y: 100 },
      max: { x: 110, y: 110 },
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.shape).toBe("first");
    expect(list.items[0]!.rotation).toBeCloseTo(Math.PI / 4);
  });

  it("restores culled markers after the viewport moves without changing the glyph", () => {
    const path = contour([[100, 100]]);
    const authored = positions(path);
    const items = new HandleItems();
    const source = stateSource();
    const offscreen = items.fromContours([path], source, undefined, {
      min: { x: 200, y: 200 },
      max: { x: 300, y: 300 },
    });
    expect(offscreen.items).toEqual([]);

    const onscreen = items.fromContours([path], source, undefined, {
      min: { x: 0, y: 0 },
      max: { x: 200, y: 200 },
    });
    expect(onscreen.items.map((item) => item.point.id)).toEqual(path.points.map(({ id }) => id));
    expect(positions(path)).toEqual(authored);
  });

  it("continues to exclude explicitly hidden markers inside the viewport", () => {
    const path = contour([[100, 100]]);
    const list = new HandleItems().fromContours(
      [path],
      stateSource(),
      (pointId) => pointId !== path.points[0]!.id,
      { min: { x: 0, y: 0 }, max: { x: 200, y: 200 } },
    );
    expect(list.items).toEqual([]);
    expect(positions(path)).toEqual([{ id: "p0", x: 100, y: 100 }]);
  });

  it("omits only the hidden marker while preserving its neighbors' geometric context", () => {
    const path = contour(
      [
        [0, 0],
        [0, 50, "offCurve"],
        [50, 100, "offCurve"],
        [100, 100],
        [100, 0],
      ],
      true,
    );
    const hidden = path.points[1]!.id;
    const list = new HandleItems().fromContours(
      [path],
      stateSource(),
      (pointId) => pointId !== hidden,
    );
    expect(list.items).toHaveLength(4);
    expect(list.items.map((item) => item.point.id)).not.toContain(hidden);
    expect(list.items[0]!.next?.id).toBe(hidden);
  });
});

describe("handles mark on-curve points resting exactly on a metric", () => {
  it("marks idle points on a metric line and leaves others alone", () => {
    const path = contour([
      [100, 500],
      [200, 499],
      [700, 500],
    ]);
    const list = new HandleItems().fromContours(
      [path],
      stateSource({ metricLines: { heights: new Set([0, 500]), advance: 600 } }),
    );

    expect(list.items.map((item) => item.showsMetricMarker)).toEqual([true, false, false]);
  });

  it("lets selection take over the look of a point on a metric", () => {
    const path = contour([[100, 500]]);
    const source = stateSource({ metricLines: { heights: new Set([500]), advance: 600 } });
    source.selection.select([path.points[0]!.id]);
    const list = new HandleItems().fromContours([path], source);

    expect(list.items[0]!.onMetric).toBe(true);
    expect(list.items[0]!.showsMetricMarker).toBe(false);
  });
});
