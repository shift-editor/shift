import { describe, expect, it } from "vitest";
import type { AnchorId, ContourId, GlyphState, PointId } from "@shift/types";
import { GlyphSourceState } from "./GlyphSourceState";

const contourId = (index: number): ContourId => `contour-${index}` as ContourId;
const pointId = (index: number): PointId => `point-${index}` as PointId;
const anchorId = (index: number): AnchorId => `anchor-${index}` as AnchorId;

function sourceState(): GlyphState {
  return {
    structure: {
      contours: [
        {
          id: contourId(1),
          closed: false,
          points: [
            { id: pointId(1), pointType: "onCurve", smooth: false },
            { id: pointId(2), pointType: "offCurve", smooth: false },
          ],
        },
      ],
      anchors: [{ id: anchorId(1), name: "top" }],
      components: [],
    },
    values: new Float64Array([500, 10, 20, 30, 40, 300, 400]),
  };
}

function pointPosition(state: GlyphSourceState, pointId: PointId) {
  const position = state.positionsFor([{ kind: "point", id: pointId }])[0];
  const point = state.geometry.point(pointId);

  return {
    source: position && { x: position.x, y: position.y },
    geometry: point && { x: point.x, y: point.y },
  };
}

describe("glyph source geometry follows coordinate patches", () => {
  it("keeps source positions and geometry lookup in sync after a position patch", () => {
    const state = new GlyphSourceState(sourceState());

    state.patchPositions([{ kind: "point", id: pointId(2), x: 75, y: 125 }]);

    expect(pointPosition(state, pointId(2))).toEqual({
      source: { x: 75, y: 125 },
      geometry: { x: 75, y: 125 },
    });
  });

  it("invalidates geometry that was read before a position patch", () => {
    const state = new GlyphSourceState(sourceState());

    expect(state.geometry.point(pointId(2))).toMatchObject({ x: 30, y: 40 });

    state.patchPositions([{ kind: "point", id: pointId(2), x: 75, y: 125 }]);

    expect(pointPosition(state, pointId(2))).toEqual({
      source: { x: 75, y: 125 },
      geometry: { x: 75, y: 125 },
    });
  });

  it("keeps contour points and all-points geometry fresh after a position patch", () => {
    const state = new GlyphSourceState(sourceState());

    expect(state.geometry.contours[0]?.points[1]).toMatchObject({
      id: pointId(2),
      x: 30,
      y: 40,
    });

    state.patchPositions([{ kind: "point", id: pointId(2), x: 75, y: 125 }]);

    expect(state.geometry.contours[0]?.points[1]).toMatchObject({
      id: pointId(2),
      x: 75,
      y: 125,
    });
    expect(state.geometry.allPoints.find((point) => point.id === pointId(2))).toMatchObject({
      x: 75,
      y: 125,
    });
  });

  it("keeps anchor positions and geometry lookup in sync after an anchor patch", () => {
    const state = new GlyphSourceState(sourceState());

    state.patchPositions([{ kind: "anchor", id: anchorId(1), x: 330, y: 440 }]);

    expect(state.positionsFor([{ kind: "anchor", id: anchorId(1) }])[0]).toMatchObject({
      x: 330,
      y: 440,
    });
    expect(state.geometry.anchor(anchorId(1))).toMatchObject({
      x: 330,
      y: 440,
    });
  });

  it("updates source metrics derived from point coordinates", () => {
    const state = new GlyphSourceState(sourceState());

    state.patchPositions([
      { kind: "point", id: pointId(1), x: -25, y: 20 },
      { kind: "point", id: pointId(2), x: 75, y: 125 },
    ]);

    expect(state.bounds).toEqual({
      min: { x: -25, y: 20 },
      max: { x: 75, y: 125 },
    });
    expect(state.sidebearings).toEqual({ lsb: -25, rsb: 425 });
  });

  it("serializes patched coordinates into state values", () => {
    const state = new GlyphSourceState(sourceState());

    state.patchPositions([
      { kind: "point", id: pointId(2), x: 75, y: 125 },
      { kind: "anchor", id: anchorId(1), x: 330, y: 440 },
    ]);

    expect([...state.state.values]).toEqual([500, 10, 20, 75, 125, 330, 440]);
  });

  it("keeps the xAdvance signal fresh after replacing packed values", () => {
    const state = new GlyphSourceState(sourceState());
    const xAdvance = state.xAdvanceCell;
    const sidebearings = state.sidebearingsCell;

    expect(xAdvance.peek()).toBe(500);
    expect(sidebearings.peek()).toEqual({ lsb: 10, rsb: 470 });

    state.replaceValues(new Float64Array([650, 10, 20, 30, 40, 300, 400]));

    expect(xAdvance.peek()).toBe(650);
    expect(state.xAdvance).toBe(650);
    expect(sidebearings.peek()).toEqual({ lsb: 10, rsb: 620 });
    expect(state.sidebearings).toEqual({ lsb: 10, rsb: 620 });
  });
});
