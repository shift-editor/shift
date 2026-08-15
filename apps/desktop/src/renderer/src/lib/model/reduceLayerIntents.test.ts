import { describe, expect, it } from "vitest";
import {
  mintAnchorId,
  mintContourId,
  mintLayerId,
  mintPointId,
  type AnchorId,
  type ContourId,
  type FontIntent,
  type GlyphState,
  type PointId,
} from "@shift/types";
import type { LocalLayerUpdate } from "@/types";
import { reduceLayerIntents } from "./reduceLayerIntents";

const layerId = mintLayerId();
const contourId = mintContourId();
const firstPointId = mintPointId();
const secondPointId = mintPointId();
const anchorId = mintAnchorId();

function layerState(): GlyphState {
  return {
    layerId,
    structure: {
      contours: [
        {
          id: contourId,
          closed: false,
          points: [
            { id: firstPointId, pointType: "onCurve", smooth: false },
            { id: secondPointId, pointType: "onCurve", smooth: false },
          ],
        },
      ],
      anchors: [{ id: anchorId, name: "top" }],
      components: [],
    },
    values: new Float64Array([500, 10, 20, 30, 40, 100, 200]),
  };
}

function reduce(intents: FontIntent[]): LocalLayerUpdate | null {
  return reduceLayerIntents(intents, layerState);
}

function replacement(update: LocalLayerUpdate | null): GlyphState {
  if (update?.kind !== "replace") throw new Error("expected a complete layer replacement");
  return update.state;
}

describe("layer intents reduce to immediate local updates", () => {
  it("combines numeric intents into one sparse patch", () => {
    const update = reduce([
      movePoints([firstPointId], [50, 60]),
      translatePoints([firstPointId, secondPointId], 5, -5),
      setXAdvance(600),
    ]);

    expect(update).toEqual({
      kind: "patch",
      positions: [
        { kind: "point", id: firstPointId, x: 55, y: 55 },
        { kind: "point", id: secondPointId, x: 35, y: 35 },
      ],
      xAdvance: 600,
    });
  });

  it("inserts structural coordinates before anchor values", () => {
    const addedContourId = mintContourId();
    const addedPointId = mintPointId();
    const state = replacement(
      reduce([addContour(addedContourId), addPoint(addedContourId, addedPointId, 70, 80)]),
    );

    expect(state.structure.contours[1]?.points[0]?.id).toBe(addedPointId);
    expect([...state.values]).toEqual([500, 10, 20, 30, 40, 70, 80, 100, 200]);
  });

  it("applies later structural intents to points added by the same edit", () => {
    const addedPointId = mintPointId();
    const state = replacement(
      reduce([
        addPoint(contourId, addedPointId, 70, 80),
        setPointSmooth(addedPointId, true),
        setContourClosed(true),
      ]),
    );

    expect(state.structure.contours[0]).toMatchObject({ closed: true });
    expect(state.structure.contours[0]?.points.at(-1)).toMatchObject({
      id: addedPointId,
      smooth: true,
    });
  });

  it("reverses point identities and their packed coordinates together", () => {
    const state = replacement(reduce([reverseContour()]));

    expect(state.structure.contours[0]?.points.map((point) => point.id)).toEqual([
      secondPointId,
      firstPointId,
    ]);
    expect([...state.values]).toEqual([500, 30, 40, 10, 20, 100, 200]);
  });

  it("removes point identities and their packed coordinates together", () => {
    const state = replacement(reduce([removePoints([firstPointId])]));

    expect(state.structure.contours[0]?.points.map((point) => point.id)).toEqual([secondPointId]);
    expect([...state.values]).toEqual([500, 30, 40, 100, 200]);
  });

  it("updates anchor structure and packed coordinates together", () => {
    const addedAnchorId = mintAnchorId();
    const state = replacement(
      reduce([
        addAnchor(addedAnchorId, 300, 400),
        moveAnchors([addedAnchorId], [350, 450]),
        removeAnchors([anchorId]),
      ]),
    );

    expect(state.structure.anchors).toEqual([{ id: addedAnchorId, name: "bottom" }]);
    expect([...state.values]).toEqual([500, 10, 20, 30, 40, 350, 450]);
  });

  it("does not mutate the source state while reducing", () => {
    const source = layerState();
    reduceLayerIntents([movePoints([firstPointId], [90, 95])], () => source);

    expect([...source.values]).toEqual([500, 10, 20, 30, 40, 100, 200]);
    expect(source.structure.contours[0]?.points).toHaveLength(2);
  });

  it("leaves Rust-only operations workspace-driven", () => {
    const intent: FontIntent = {
      kind: "applyBooleanOp",
      applyBooleanOp: {
        layerId,
        contourIdA: contourId,
        contourIdB: mintContourId(),
        operation: "union",
      },
    };

    expect(reduce([intent])).toBeNull();
  });
});

function movePoints(pointIds: PointId[], coords: number[]): FontIntent {
  return { kind: "movePoints", movePoints: { layerId, pointIds, coords } };
}

function translatePoints(pointIds: PointId[], dx: number, dy: number): FontIntent {
  return { kind: "translatePoints", translatePoints: { layerId, pointIds, dx, dy } };
}

function reverseContour(): FontIntent {
  return { kind: "reverseContour", reverseContour: { layerId, contourId } };
}

function removePoints(pointIds: PointId[]): FontIntent {
  return { kind: "removePoints", removePoints: { layerId, pointIds } };
}

function setXAdvance(width: number): FontIntent {
  return { kind: "setXAdvance", setXAdvance: { layerId, width } };
}

function addContour(id: ContourId): FontIntent {
  return { kind: "addContour", addContour: { layerId, contourId: id, closed: false } };
}

function addPoint(targetContourId: ContourId, pointId: PointId, x: number, y: number): FontIntent {
  return {
    kind: "addPoints",
    addPoints: {
      layerId,
      contourId: targetContourId,
      points: [{ id: pointId, x, y, pointType: "onCurve", smooth: false }],
    },
  };
}

function setPointSmooth(pointId: PointId, smooth: boolean): FontIntent {
  return { kind: "setPointSmooth", setPointSmooth: { layerId, pointId, smooth } };
}

function setContourClosed(closed: boolean): FontIntent {
  return { kind: "setContourClosed", setContourClosed: { layerId, contourId, closed } };
}

function addAnchor(id: AnchorId, x: number, y: number): FontIntent {
  return {
    kind: "addAnchors",
    addAnchors: { layerId, anchors: [{ id, name: "bottom", x, y }] },
  };
}

function moveAnchors(anchorIds: AnchorId[], coords: number[]): FontIntent {
  return { kind: "moveAnchors", moveAnchors: { layerId, anchorIds, coords } };
}

function removeAnchors(anchorIds: AnchorId[]): FontIntent {
  return { kind: "removeAnchors", removeAnchors: { layerId, anchorIds } };
}
