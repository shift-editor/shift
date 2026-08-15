import { describe, expect, it } from "vitest";
import {
  mintAnchorId,
  mintContourId,
  mintLayerId,
  mintPointId,
  type GlyphState,
} from "@shift/types";
import { LayerStateDraft } from "./LayerStateDraft";

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

describe("local layer operations preserve packed glyph state", () => {
  it("combines numeric operations in application order", () => {
    const draft = new LayerStateDraft(layerState());

    expect(draft.movePoints({ layerId, pointIds: [firstPointId], coords: [50, 60] })).toBe(true);
    expect(
      draft.translatePoints({
        layerId,
        pointIds: [firstPointId, secondPointId],
        dx: 5,
        dy: -5,
      }),
    ).toBe(true);
    expect(draft.setXAdvance({ layerId, width: 600 })).toBe(true);

    expect([...draft.state.values]).toEqual([600, 55, 55, 35, 35, 100, 200]);
  });

  it("inserts point coordinates before anchor values", () => {
    const draft = new LayerStateDraft(layerState());
    const addedContourId = mintContourId();
    const addedPointId = mintPointId();

    expect(draft.addContour({ layerId, contourId: addedContourId, closed: false })).toBe(true);
    expect(
      draft.addPoints({
        layerId,
        contourId: addedContourId,
        points: [{ id: addedPointId, x: 70, y: 80, pointType: "onCurve", smooth: false }],
      }),
    ).toBe(true);

    expect(draft.state.structure.contours[1]?.points[0]?.id).toBe(addedPointId);
    expect([...draft.state.values]).toEqual([500, 10, 20, 30, 40, 70, 80, 100, 200]);
  });

  it("reverses identities and coordinates together", () => {
    const draft = new LayerStateDraft(layerState());

    expect(draft.reverseContour({ layerId, contourId })).toBe(true);

    expect(draft.state.structure.contours[0]?.points.map((point) => point.id)).toEqual([
      secondPointId,
      firstPointId,
    ]);
    expect([...draft.state.values]).toEqual([500, 30, 40, 10, 20, 100, 200]);
  });

  it("removes point identities and coordinates together", () => {
    const draft = new LayerStateDraft(layerState());

    expect(draft.removePoints({ layerId, pointIds: [firstPointId] })).toBe(true);

    expect(draft.state.structure.contours[0]?.points.map((point) => point.id)).toEqual([
      secondPointId,
    ]);
    expect([...draft.state.values]).toEqual([500, 30, 40, 100, 200]);
  });

  it("updates anchor structure and coordinates together", () => {
    const draft = new LayerStateDraft(layerState());
    const addedAnchorId = mintAnchorId();

    expect(
      draft.addAnchors({
        layerId,
        anchors: [{ id: addedAnchorId, name: "bottom", x: 300, y: 400 }],
      }),
    ).toBe(true);
    expect(draft.moveAnchors({ layerId, anchorIds: [addedAnchorId], coords: [350, 450] })).toBe(
      true,
    );
    expect(draft.removeAnchors({ layerId, anchorIds: [anchorId] })).toBe(true);

    expect(draft.state.structure.anchors).toEqual([{ id: addedAnchorId, name: "bottom" }]);
    expect([...draft.state.values]).toEqual([500, 10, 20, 30, 40, 350, 450]);
  });

  it("does not mutate its source state", () => {
    const source = layerState();
    const draft = new LayerStateDraft(source);

    expect(draft.movePoints({ layerId, pointIds: [firstPointId], coords: [90, 95] })).toBe(true);

    expect([...source.values]).toEqual([500, 10, 20, 30, 40, 100, 200]);
    expect(source.structure.contours[0]?.points).toHaveLength(2);
  });
});
