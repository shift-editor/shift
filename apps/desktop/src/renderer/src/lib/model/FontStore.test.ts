import { describe, expect, it } from "vitest";
import {
  asAnchorId,
  asContourId,
  asPointId,
  type AnchorId,
  type ContourId,
  type GlyphId,
  type GlyphName,
  type GlyphState,
  type GlyphStructure,
  type LayerId,
  type PointId,
  type SourceId,
  type Unicode,
} from "@shift/types";
import { segmentIdFor } from "@shift/glyph-state";
import type { WorkspaceGlyphSnapshot, WorkspaceSnapshot } from "@shared/workspace/protocol";
import { Font } from "./Font";
import { FontStore } from "./FontStore";

const GLYPH_ID = "glyph_shared" as GlyphId;
const SOURCE_ID = "source_regular" as SourceId;
const LAYER_A_ID = "layer_a" as LayerId;
const LAYER_B_ID = "layer_b" as LayerId;
const CONTOUR_ID = asContourId("contour_a");
const NEXT_CONTOUR_ID = asContourId("contour_b");
const POINT_1_ID = asPointId("point_1");
const POINT_2_ID = asPointId("point_2");
const POINT_3_ID = asPointId("point_3");
const POINT_4_ID = asPointId("point_4");
const NEXT_POINT_ID = asPointId("point_next");
const ANCHOR_ID = asAnchorId("anchor_a");
const NEXT_ANCHOR_ID = asAnchorId("anchor_b");
const SEGMENT_ID = segmentIdFor(POINT_1_ID, POINT_4_ID);
const NEXT_SEGMENT_ID = segmentIdFor(NEXT_POINT_ID, POINT_4_ID);

describe("FontStore glyph snapshot application", () => {
  it("only materializes layer snapshots that match current font records", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));

    store.applyGlyphSnapshots([glyphSnapshot(LAYER_B_ID)]);

    expect(store.layerState(LAYER_A_ID)).toBeNull();
    expect(store.layerState(LAYER_B_ID)).toBeNull();

    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID)]);

    expect(store.layerState(LAYER_A_ID)).not.toBeNull();
  });

  it("removes concrete layer state when the layer record is removed", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    store.applyWorkspaceChange({
      glyphs: snapshot("document-a", LAYER_B_ID).glyphs,
      layers: [],
      dependents: [],
    });

    expect(store.layerState(LAYER_A_ID)).toBeNull();
    expect(store.layerIdForPoint(POINT_1_ID)).toBeNull();
  });
});

describe("FontStore glyph object ownership", () => {
  it("indexes concrete layer structure ids by owner", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    expect(store.layerIdForPoint(POINT_1_ID)).toBeNull();

    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    expect(store.layerIdForPoint(POINT_1_ID)).toBe(LAYER_A_ID);
    expect(store.contourIdForPoint(POINT_1_ID)).toBe(CONTOUR_ID);
    expect(store.layerIdForContour(CONTOUR_ID)).toBe(LAYER_A_ID);
    expect(store.layerIdForAnchor(ANCHOR_ID)).toBe(LAYER_A_ID);
    expect(store.layerIdForSegment(SEGMENT_ID)).toBe(LAYER_A_ID);
    expect(store.contourIdForSegment(SEGMENT_ID)).toBe(CONTOUR_ID);
    expect(store.pointIdsForSegment(SEGMENT_ID)).toEqual([
      POINT_1_ID,
      POINT_2_ID,
      POINT_3_ID,
      POINT_4_ID,
    ]);
  });

  it("rebuilds after a concrete layer structure replacement", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    const nextStructure = structure({
      contourId: NEXT_CONTOUR_ID,
      pointIds: [NEXT_POINT_ID, POINT_2_ID, POINT_3_ID, POINT_4_ID],
      anchorId: NEXT_ANCHOR_ID,
    });
    store.applyWorkspaceChange({
      layers: [
        {
          layerId: LAYER_A_ID,
          structure: nextStructure,
          values: valuesFor(nextStructure),
          changed: {
            pointIds: [NEXT_POINT_ID],
            contourIds: [NEXT_CONTOUR_ID],
            anchorIds: [NEXT_ANCHOR_ID],
            guidelineIds: [],
            componentIds: [],
          },
        },
      ],
      dependents: [],
    });

    expect(store.layerIdForPoint(POINT_1_ID)).toBeNull();
    expect(store.layerIdForContour(CONTOUR_ID)).toBeNull();
    expect(store.layerIdForAnchor(ANCHOR_ID)).toBeNull();
    expect(store.layerIdForSegment(SEGMENT_ID)).toBeNull();
    expect(store.layerIdForPoint(NEXT_POINT_ID)).toBe(LAYER_A_ID);
    expect(store.contourIdForPoint(NEXT_POINT_ID)).toBe(NEXT_CONTOUR_ID);
    expect(store.layerIdForContour(NEXT_CONTOUR_ID)).toBe(LAYER_A_ID);
    expect(store.layerIdForAnchor(NEXT_ANCHOR_ID)).toBe(LAYER_A_ID);
    expect(store.layerIdForSegment(NEXT_SEGMENT_ID)).toBe(LAYER_A_ID);
  });

  it("materializes added layer structure from the same workspace change", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    const nextStructure = structure({
      contourId: NEXT_CONTOUR_ID,
      pointIds: [NEXT_POINT_ID, POINT_2_ID, POINT_3_ID, POINT_4_ID],
      anchorId: NEXT_ANCHOR_ID,
    });

    store.applyWorkspaceChange({
      glyphs: snapshot("document-a", LAYER_B_ID).glyphs,
      layers: [
        {
          layerId: LAYER_B_ID,
          structure: nextStructure,
          values: valuesFor(nextStructure),
          changed: {
            pointIds: [NEXT_POINT_ID],
            contourIds: [NEXT_CONTOUR_ID],
            anchorIds: [NEXT_ANCHOR_ID],
            guidelineIds: [],
            componentIds: [],
          },
        },
      ],
      dependents: [],
    });

    expect(store.layerState(LAYER_B_ID)).not.toBeNull();
    expect(store.layerIdForPoint(NEXT_POINT_ID)).toBe(LAYER_B_ID);
    expect(store.contourIdForPoint(NEXT_POINT_ID)).toBe(NEXT_CONTOUR_ID);
    expect(store.layerIdForAnchor(NEXT_ANCHOR_ID)).toBe(LAYER_B_ID);
    expect(store.layerIdForSegment(NEXT_SEGMENT_ID)).toBe(LAYER_B_ID);
  });

  it("forwards ownership queries through Font", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    const font = new Font(store);
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    expect(font.layerIdForPoint(POINT_1_ID)).toBe(LAYER_A_ID);
    expect(font.contourIdForPoint(POINT_1_ID)).toBe(CONTOUR_ID);
    expect(font.layerIdForAnchor(ANCHOR_ID)).toBe(LAYER_A_ID);
    expect(font.layerIdForSegment(SEGMENT_ID)).toBe(LAYER_A_ID);
    expect(font.contourIdForSegment(SEGMENT_ID)).toBe(CONTOUR_ID);
    expect(font.pointIdsForSegment(SEGMENT_ID)).toEqual([
      POINT_1_ID,
      POINT_2_ID,
      POINT_3_ID,
      POINT_4_ID,
    ]);
  });
});

function snapshot(documentId: string, layerId: LayerId): WorkspaceSnapshot {
  return {
    documentId,
    metadata: { familyName: "Untitled Font" },
    metrics: { unitsPerEm: 1000, ascender: 800, descender: -200 },
    glyphs: [
      {
        id: GLYPH_ID,
        name: "A" as GlyphName,
        unicodes: [65 as Unicode],
        componentBaseGlyphIds: [],
        layers: [{ id: layerId, sourceId: SOURCE_ID }],
      },
    ],
    sources: [
      {
        id: SOURCE_ID,
        name: "Regular",
        location: { values: {} },
      },
    ],
    axes: [],
    axisMappings: [],
    namedInstances: [],
  };
}

function glyphSnapshot(
  layerId: LayerId,
  glyphStructure: GlyphStructure = emptyStructure(),
): WorkspaceGlyphSnapshot {
  return {
    glyphId: GLYPH_ID,
    layers: [
      {
        glyphId: GLYPH_ID,
        sourceId: SOURCE_ID,
        state: glyphState(layerId, glyphStructure),
      },
    ],
  };
}

function glyphState(layerId: LayerId, glyphStructure: GlyphStructure): GlyphState {
  return {
    layerId,
    structure: glyphStructure,
    values: valuesFor(glyphStructure),
  };
}

function emptyStructure(): GlyphStructure {
  return { contours: [], anchors: [], components: [] };
}

function structure({
  contourId = CONTOUR_ID,
  pointIds = [POINT_1_ID, POINT_2_ID, POINT_3_ID, POINT_4_ID],
  anchorId = ANCHOR_ID,
}: {
  readonly contourId?: ContourId;
  readonly pointIds?: readonly PointId[];
  readonly anchorId?: AnchorId;
} = {}): GlyphStructure {
  return {
    contours: [
      {
        id: contourId,
        points: [
          { id: pointIds[0]!, pointType: "onCurve", smooth: false },
          { id: pointIds[1]!, pointType: "offCurve", smooth: false },
          { id: pointIds[2]!, pointType: "offCurve", smooth: false },
          { id: pointIds[3]!, pointType: "onCurve", smooth: false },
        ],
        closed: false,
      },
    ],
    anchors: [{ id: anchorId, x: 50, y: 100 }],
    components: [],
  };
}

function valuesFor(glyphStructure: GlyphStructure): Float64Array {
  let length = 1;
  for (const contour of glyphStructure.contours) length += contour.points.length * 2;
  length += glyphStructure.anchors.length * 2;
  length += glyphStructure.components.length * 9;

  const values = new Float64Array(length);
  values[0] = 600;
  return values;
}
