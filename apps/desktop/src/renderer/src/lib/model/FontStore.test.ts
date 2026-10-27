import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  asAnchorId,
  asContourId,
  asPointId,
  DECOMPOSED_COMPONENT_VALUE_COUNT,
  GLYPH_ADVANCE_VALUE_COUNT,
  GLYPH_ADVANCE_VALUE_OFFSET,
  GLYPH_ANCHOR_VALUE_COUNT,
  GLYPH_POINT_VALUE_COUNT,
  type AppliedChange,
  type AnchorId,
  type ContourId,
  type GlyphId,
  type GlyphName,
  type GlyphSnapshot,
  type GlyphState,
  type GlyphStructure,
  type LayerId,
  type PointId,
  type SourceId,
  type Unicode,
} from "@shift/types";
import { segmentIdFor } from "@shift/glyph-state";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import { effect, track } from "@shift/editor/signals";
import { Font, FontStore } from "@shift/editor/model";
import { createWorkspaceStack } from "@/testing/workspaceStack";

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
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });

    store.applyGlyphSnapshots([glyphSnapshot(LAYER_B_ID)]);

    expect(store.layerState(LAYER_A_ID)).toBeNull();
    expect(store.layerState(LAYER_B_ID)).toBeNull();

    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID)]);

    expect(store.layerState(LAYER_A_ID)).not.toBeNull();
  });

  it("removes concrete layer state when the layer record is removed", () => {
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    store.confirmEdit({
      next: { glyphChanges: { updated: snapshot("document-a", LAYER_B_ID).glyphs, removed: [] } },
      layers: [],
      dependents: [],
    });

    expect(store.layerState(LAYER_A_ID)).toBeNull();
    expect(store.layerIdForPoint(POINT_1_ID)).toBeNull();
  });
});

describe("FontStore record index", () => {
  it("places changed glyph records by name and drops removed ones", () => {
    const base = snapshot("document-a", LAYER_A_ID);
    const record = (id: string, name: string) => ({
      id: id as GlyphId,
      name: name as GlyphName,
      unicodes: [],
      componentBaseGlyphIds: [],
      layers: [],
    });
    const store = new FontStore({
      workspace: {
        ...base,
        glyphs: [...base.glyphs, record("glyph_m", "M"), record("glyph_t", "T")],
      },
    });
    const font = new Font({ store });

    store.confirmEdit({
      next: {
        glyphChanges: {
          updated: [record("glyph_m", "Z"), record("glyph_b", "B")],
          removed: ["glyph_t" as GlyphId],
        },
      },
      layers: [],
      dependents: [],
    });

    expect(font.glyphEntries().map(({ name }) => name)).toEqual(["A", "B", "Z"]);
  });

  it("indexes every glyph relation once and follows glyph record changes", () => {
    const base = snapshot("document-a", LAYER_A_ID);
    const acute = {
      id: "glyph_acute" as GlyphId,
      name: "acute" as GlyphName,
      unicodes: [180 as Unicode, 65 as Unicode],
      componentBaseGlyphIds: [],
      layers: [],
    };
    const aacute = {
      id: "glyph_aacute" as GlyphId,
      name: "Aacute" as GlyphName,
      unicodes: [193 as Unicode],
      componentBaseGlyphIds: [GLYPH_ID, acute.id],
      layers: [{ id: LAYER_B_ID, sourceId: SOURCE_ID }],
    };
    const store = new FontStore({
      workspace: { ...base, glyphs: [...base.glyphs, acute, aacute] },
    });
    const font = new Font({ store });

    const index = store.recordIndexCell.peek();
    expect(index.entries.map(({ name }) => name)).toEqual(["A", "acute", "Aacute"]);
    expect(index.unicodes).toEqual([65, 180, 193]);
    expect(index.nameByUnicode.get(65 as Unicode)).toBe("A");
    expect(index.layerByGlyphSource.size).toBe(2);
    expect(font.recordForName("Aacute" as GlyphName)?.id).toBe(aacute.id);
    expect(font.componentBaseNamesForName("Aacute" as GlyphName)).toEqual(["A", "acute"]);
    expect(font.dependentNamesForName("acute" as GlyphName)).toEqual(["Aacute"]);
    expect(font.nameForUnicode(193 as Unicode)).toBe("Aacute");

    store.confirmEdit({
      next: { glyphChanges: { updated: [], removed: [aacute.id] } },
      layers: [],
      dependents: [],
    });

    expect(font.hasGlyph(aacute.id)).toBe(false);
    expect(font.entryForName("Aacute" as GlyphName)).toBeNull();
    expect(font.dependentNamesForName("acute" as GlyphName)).toEqual([]);
    expect(font.glyphEntries().map(({ name }) => name)).toEqual(["A", "acute"]);
  });
});

describe("FontStore glyph object ownership", () => {
  it("indexes concrete layer structure ids by owner", () => {
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
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
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);

    const nextStructure = structure({
      contourId: NEXT_CONTOUR_ID,
      pointIds: [NEXT_POINT_ID, POINT_2_ID, POINT_3_ID, POINT_4_ID],
      anchorId: NEXT_ANCHOR_ID,
    });
    store.applyEngineEdit({
      layers: [
        {
          layerId: LAYER_A_ID,
          structure: nextStructure,
          values: valuesFor(nextStructure),
          structural: true,
        },
      ],
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
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    const nextStructure = structure({
      contourId: NEXT_CONTOUR_ID,
      pointIds: [NEXT_POINT_ID, POINT_2_ID, POINT_3_ID, POINT_4_ID],
      anchorId: NEXT_ANCHOR_ID,
    });

    store.confirmEdit({
      next: { glyphChanges: { updated: snapshot("document-a", LAYER_B_ID).glyphs, removed: [] } },
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

  it("invalidates committed font dependents after a values-only native echo", () => {
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    const font = new Font({ store });
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);
    let runs = 0;
    const subscription = effect(() => {
      track(font.committedRevisionCell);
      runs += 1;
    });

    store.confirmEdit(valuesOnlyChange());

    expect(runs).toBe(2);
    subscription.dispose();
    font.dispose();
  });

  it("publishes values-only roots and component dependents for atlas invalidation", () => {
    const dependentGlyphId = "glyph_dependent" as GlyphId;
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    const font = new Font({ store });
    store.applyGlyphSnapshots([glyphSnapshot(LAYER_A_ID, structure())]);
    let invalidGlyphIds: readonly GlyphId[] | null = null;
    const subscription = effect(() => {
      invalidGlyphIds = font.invalidGlyphsCell.value.glyphIds;
    });

    store.confirmEdit({
      ...valuesOnlyChange(),
      dependents: [dependentGlyphId],
    });

    expect(invalidGlyphIds).toEqual([dependentGlyphId, GLYPH_ID]);
    subscription.dispose();
    font.dispose();
  });

  it("forwards ownership queries through Font", () => {
    const store = new FontStore({
      workspace: snapshot("document-a", LAYER_A_ID),
    });
    const font = new Font({ store });
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

function valuesOnlyChange(): AppliedChange {
  return {
    layers: [
      {
        layerId: LAYER_A_ID,
        values: valuesFor(structure()),
        changed: {
          pointIds: [POINT_1_ID],
          contourIds: [],
          anchorIds: [],
          guidelineIds: [],
          componentIds: [],
        },
      },
    ],
    dependents: [],
  };
}

function snapshot(workspaceId: string, layerId: LayerId): WorkspaceSnapshot {
  return {
    workspaceId,
    metadata: { familyName: "Untitled Font" },
    metrics: { unitsPerEm: 1000 },
    metricDefinitions: [],
    sourceMetricsInterpolation: null,
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
        metricValues: [],
      },
    ],
    axes: [],
    axisMappings: [],
    axisMappingBases: [],
    namedInstances: [],
    languageIds: null,
    kerning: { groups: [], sources: [] },
  };
}

function glyphSnapshot(
  layerId: LayerId,
  glyphStructure: GlyphStructure = emptyStructure(),
): GlyphSnapshot {
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
    anchors: [{ id: anchorId }],
    components: [],
  };
}

function valuesFor(glyphStructure: GlyphStructure): Float64Array {
  let length = GLYPH_ADVANCE_VALUE_COUNT;
  for (const contour of glyphStructure.contours) {
    length += contour.points.length * GLYPH_POINT_VALUE_COUNT;
  }
  length += glyphStructure.anchors.length * GLYPH_ANCHOR_VALUE_COUNT;
  length += glyphStructure.components.length * DECOMPOSED_COMPONENT_VALUE_COUNT;

  const values = new Float64Array(length);
  values[GLYPH_ADVANCE_VALUE_OFFSET] = 600;
  return values;
}

describe("FontStore interpolation projections follow axis mappings", () => {
  const fixture = resolve(process.cwd(), "../../fixtures/fonts/MappedWeight.glyphs");

  it("replaces cached glyph and metric normalization after mapping edits and undo", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(fixture);
    const glyph = await stack.font.loadGlyph(stack.font.recordForName("A" as GlyphName)!.id);
    const axisId = stack.font.getAxes()[0]!.id;
    const mapping = stack.font.getAxisMappings()[0]!;
    await stack.font.setAxisMappings([
      {
        ...mapping,
        points: mapping.points.map((point) => ({
          ...point,
          output: {
            values: {
              [axisId]: Math.max(
                point.output.values[axisId]!,
                86 + (point.output.values[axisId]! - 86) * 2,
              ),
            },
          },
        })),
      },
    ]);

    expect(
      stack.store.projection(glyph.id)!.interpolation!.basis.designNormalization[0]!.maximum,
    ).toBeCloseTo(234);
    expect(
      stack.store.workspaceCell.peek()!.sourceMetricsInterpolation!.basis.designNormalization[0]!
        .maximum,
    ).toBeCloseTo(234);
    await stack.editCoordinator.undo();
    expect(
      stack.store.projection(glyph.id)!.interpolation!.basis.designNormalization[0]!.maximum,
    ).toBe(160);
    expect(
      stack.store.workspaceCell.peek()!.sourceMetricsInterpolation!.basis.designNormalization[0]!
        .maximum,
    ).toBe(160);
  });
});
