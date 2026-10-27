import { describe, expect, it } from "vitest";
import type { ContourId, GlyphState, LayerId, PointId, Source, SourceId } from "@shift/types";
import { GlyphLayer } from "./Glyph";
import { GlyphLayerState } from "./GlyphLayerState";

describe("local glyph layer position edits", () => {
  it("retains a finished position edit without a workspace", () => {
    const pointId = "point-memory" as PointId;
    const initialState: GlyphState = {
      layerId: "layer-memory" as LayerId,
      structure: {
        contours: [
          {
            id: "contour-memory" as ContourId,
            closed: false,
            points: [{ id: pointId, pointType: "onCurve", smooth: false }],
          },
        ],
        anchors: [],
        components: [],
      },
      values: new Float64Array([500, 100, 100]),
    };
    const state = new GlyphLayerState(initialState);
    const source: Source = {
      id: "source-memory" as SourceId,
      name: "Regular",
      location: { values: {} },
      metricValues: [],
    };
    const layer = new GlyphLayer(source, null, state);

    const edit = layer.beginEdit();
    edit.setPositions([{ kind: "point", id: pointId, x: 175, y: 125 }]);
    edit.finish("Move point");

    expect(layer.point(pointId)).toMatchObject({ x: 175, y: 125 });

    const canceled = layer.beginEdit();
    canceled.setPositions([{ kind: "point", id: pointId, x: 250, y: 200 }]);
    canceled.cancel();

    expect(layer.point(pointId)).toMatchObject({ x: 175, y: 125 });
  });
});
