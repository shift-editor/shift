import { describe, expect, it } from "vitest";
import { effect } from "@shift/editor/signals";
import type { AnchorId, ContourId, GlyphState, LayerId, PointId } from "@shift/types";
import { GlyphLayerState } from "@shift/editor/model";

// Mechanics of the packed TypeScript layer copy (LayerBuffers behind GlyphLayerState),
// which #789 deletes. These have no user-visible equivalent; delete this file with it.
// Observable layer behaviour lives in GlyphLayerState.test.ts.

const contourId = "contour-1" as ContourId;
const pointId = (index: number): PointId => `point-${index}` as PointId;
const anchorId = "anchor-1" as AnchorId;

function layerState(): GlyphState {
  return {
    layerId: "layer-1" as LayerId,
    structure: {
      contours: [
        {
          id: contourId,
          closed: false,
          points: [
            { id: pointId(1), pointType: "onCurve", smooth: false },
            { id: pointId(2), pointType: "onCurve", smooth: false },
          ],
        },
      ],
      anchors: [{ id: anchorId, name: "top" }],
      components: [],
    },
    values: new Float64Array([500, 10, 20, 30, 40, 300, 400]),
  };
}

describe("packed layer buffers", () => {
  it("serializes patched coordinates into state values", () => {
    const state = new GlyphLayerState(layerState());

    state.patchPositions([
      { kind: "point", id: pointId(2), x: 75, y: 125 },
      { kind: "anchor", id: anchorId, x: 330, y: 440 },
    ]);

    expect([...state.state.values]).toEqual([500, 10, 20, 75, 125, 330, 440]);
  });

  it("does not invalidate contour coordinates when only advance changes", () => {
    const state = new GlyphLayerState(layerState());
    const observed: number[] = [];
    const subscription = effect(() => {
      observed.push(state.buffers.contours[0]!.valuesCell.value[0] ?? NaN);
    });

    state.replaceValues(new Float64Array([650, 10, 20, 30, 40, 300, 400]));

    expect(observed).toEqual([10]);
    subscription.dispose();
  });
});
