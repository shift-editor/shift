import { describe, expect, it } from "vitest";
import { asContourId, asLayerId, asPointId, type GlyphState, type PointId } from "@shift/types";
import { LayerBuffers } from "./LayerBuffers";

const contourId = asContourId("contour");
const [a, b, c] = ["a", "b", "c"].map((id) => asPointId(id)) as [PointId, PointId, PointId];

/** One closed contour of three on-curve points at (0, 0), (10, 0), and (20, 0). */
function triangle(): LayerBuffers {
  const state: GlyphState = {
    layerId: asLayerId("layer"),
    structure: {
      contours: [
        {
          id: contourId,
          closed: true,
          points: [a, b, c].map((id) => ({ id, pointType: "onCurve" as const, smooth: false })),
        },
      ],
      anchors: [],
      components: [],
    },
    values: new Float64Array([500, 0, 0, 10, 0, 20, 0]),
  };
  return LayerBuffers.fromState(state);
}

/** Reads through the contour's geometry, not the id lookup the edits use. */
function xOf(layer: LayerBuffers, pointId: PointId): number | undefined {
  return layer.contour(contourId)?.point(pointId)?.x;
}

describe("LayerBuffers point lookups after structural edits", () => {
  it("moves the point it names after points are inserted before it", () => {
    const layer = triangle();
    const inserted = asPointId("inserted");
    layer.movePoints([b], [12, 0]);

    layer.addPoints(
      [{ id: inserted, x: 5, y: 0, pointType: "onCurve", smooth: false }],
      contourId,
      b,
    );
    layer.movePoints([b, inserted], [11, 1, 6, 1]);

    expect(layer.contour(contourId)?.data.points.map((point) => point.id)).toEqual([
      a,
      inserted,
      b,
      c,
    ]);
    expect([xOf(layer, a), xOf(layer, inserted), xOf(layer, b), xOf(layer, c)]).toEqual([
      0, 6, 11, 20,
    ]);
  });

  it("moves the point it names after earlier points are removed", () => {
    const layer = triangle();
    layer.movePoints([c], [22, 0]);

    layer.removePoints([a]);
    layer.movePoints([c], [21, 0]);

    expect([xOf(layer, a), xOf(layer, b), xOf(layer, c)]).toEqual([undefined, 10, 21]);
  });

  it("moves the point it names after the contour is reversed", () => {
    const layer = triangle();
    layer.movePoints([a], [1, 0]);

    layer.reverseContour(contourId);
    layer.movePoints([a], [-1, 0]);

    expect([xOf(layer, a), xOf(layer, b), xOf(layer, c)]).toEqual([-1, 10, 20]);
  });

  it("rejects a move naming a point the layer lacks and moves nothing", () => {
    const layer = triangle();

    expect(layer.movePoints([a, asPointId("missing")], [5, 0, 6, 0])).toBe(false);
    expect([xOf(layer, a), xOf(layer, b), xOf(layer, c)]).toEqual([0, 10, 20]);
  });
});
