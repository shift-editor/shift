import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  GLYPH_ADVANCE_VALUE_COUNT,
  type GlyphId,
  type GlyphName,
  type GlyphSnapshot,
  type LayerId,
  type SourceId,
  type Unicode,
} from "@shift/types";
import { Point } from "@shift/glyph-state";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import { FontStore, type Font } from "@shift/editor/model";
import { createWorkspaceStack } from "@/testing/workspaceStack";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

/** Opens MutatorSans through the real workspace stack: Rust reads the fixture and echoes every edit. */
async function openMutatorSans(): Promise<Font> {
  const stack = createWorkspaceStack();
  await stack.openWorkspace(MUTATOR_SANS);
  return stack.font;
}

function glyphId(font: Font, name: string): GlyphId {
  const record = font.recordForName(name as GlyphName);
  if (!record) throw new Error(`fixture has no ${name}`);
  return record.id;
}

function sourceId(font: Font, name: string): SourceId {
  const source = font.sources.find((candidate) => candidate.name === name);
  if (!source) throw new Error(`fixture has no ${name} source`);
  return source.id;
}

async function defaultLayer(font: Font, name: string) {
  const glyph = await font.loadGlyph(glyphId(font, name));
  return glyph.layerForSource(font.defaultSource.id)!;
}

describe("the font directory follows the workspace's glyph records", () => {
  it("indexes each glyph relation once and follows an identity change", async () => {
    const font = await openMutatorSans();
    const aacute = glyphId(font, "Aacute");

    // Aacute references acute in each of its four masters; the directory lists it once.
    expect(font.componentBaseNamesForName("Aacute" as GlyphName)).toEqual(["acute", "A"]);
    expect(font.dependentNamesForName("acute" as GlyphName)).toEqual(["Aacute"]);
    expect(font.nameForUnicode(193 as Unicode)).toBe("Aacute");

    font.updateGlyphIdentity(aacute, "Aacute.ss01" as GlyphName, []);
    await font.editCoordinator.settled();

    expect(font.entryForName("Aacute" as GlyphName)).toBeNull();
    expect(font.entryForUnicode(193 as Unicode)).toBeNull();
    expect(font.recordForName("Aacute.ss01" as GlyphName)?.id).toBe(aacute);
    expect(font.dependentNamesForName("acute" as GlyphName)).toEqual(["Aacute.ss01"]);
  });
});

describe("the font knows which layer owns each point, contour, anchor and segment", () => {
  it("indexes a loaded layer's structure by owner", async () => {
    const font = await openMutatorSans();
    const o = await defaultLayer(font, "O");
    const contour = o.contours[0]!;
    const curve = contour.segments().find((segment) => segment.asCubic())!;
    const e = await defaultLayer(font, "E");
    const anchor = e.anchors[0]!;

    expect(font.layerIdForPoint(contour.points[0]!.id)).toBe(o.id);
    expect(font.contourIdForPoint(contour.points[0]!.id)).toBe(contour.id);
    expect(font.layerIdForContour(contour.id)).toBe(o.id);
    expect(font.layerIdForAnchor(anchor.id)).toBe(e.id);
    expect(font.layerIdForSegment(curve.id)).toBe(o.id);
    expect(font.contourIdForSegment(curve.id)).toBe(contour.id);
    expect(font.pointIdsForSegment(curve.id)).toEqual(curve.pointIds);
    expect(curve.pointIds).toHaveLength(4);
  });

  it("re-indexes a layer whose contours and anchors were replaced", async () => {
    const font = await openMutatorSans();
    const layer = await defaultLayer(font, "E");
    const contour = layer.contours[0]!;
    const segment = contour.segments()[0]!;
    const anchor = layer.anchors[0]!;

    layer.removePoints(contour.points.map((point) => point.id));
    layer.removeAnchors([anchor.id]);
    const nextContour = layer.addContour();
    const [nextPoint] = layer.addPoints(nextContour, [
      Point.onCurve({ x: 0, y: 0 }),
      Point.onCurve({ x: 100, y: 0 }),
    ]);
    const nextAnchor = layer.addAnchor("top", { x: 50, y: 700 });
    await font.editCoordinator.settled();

    expect(font.layerIdForPoint(contour.points[0]!.id)).toBeNull();
    expect(font.layerIdForContour(contour.id)).toBeNull();
    expect(font.layerIdForAnchor(anchor.id)).toBeNull();
    expect(font.layerIdForSegment(segment.id)).toBeNull();
    expect(font.layerIdForPoint(nextPoint!)).toBe(layer.id);
    expect(font.contourIdForPoint(nextPoint!)).toBe(nextContour);
    expect(font.layerIdForContour(nextContour)).toBe(layer.id);
    expect(font.layerIdForAnchor(nextAnchor)).toBe(layer.id);
    expect(font.layerIdForSegment(layer.contour(nextContour)!.segments()[0]!.id)).toBe(layer.id);
  });

  it("drops a deleted layer's structure, and restores it when the layer comes back", async () => {
    const font = await openMutatorSans();
    const acute = glyphId(font, "acute");
    const glyph = await font.loadGlyph(acute);
    const boldWide = sourceId(font, "BoldWide");
    const layer = glyph.layerForSource(boldWide)!;
    const pointId = layer.allPoints[0]!.id;

    font.deleteSource(boldWide);
    await font.editCoordinator.settled();

    expect(glyph.layerForSource(boldWide)).toBeNull();
    expect(font.layerIdForPoint(pointId)).toBeNull();

    // Undo restores the layer record and its structure in one workspace change.
    await font.editCoordinator.undo();
    await font.editCoordinator.settled();

    const restored = font.layerIdFor(acute, boldWide);
    expect(restored).not.toBeNull();
    expect(font.layerIdForPoint(pointId)).toBe(restored);
  });
});

describe("a point move that changes only coordinates", () => {
  it("advances the font's committed revision", async () => {
    const font = await openMutatorSans();
    const layer = await defaultLayer(font, "acute");
    const before = font.committedRevisionCell.peek();

    layer.movePoints([layer.allPoints[0]!.id], { x: 5, y: 0 });
    await font.editCoordinator.settled();

    expect(font.committedRevisionCell.peek()).toBeGreaterThan(before);
  });

  it("invalidates the moved glyph and every composite that uses it", async () => {
    const font = await openMutatorSans();
    const layer = await defaultLayer(font, "acute");

    layer.movePoints([layer.allPoints[0]!.id], { x: 5, y: 0 });
    await font.editCoordinator.settled();

    expect(font.invalidGlyphsCell.peek().glyphIds).toEqual([
      glyphId(font, "Aacute"),
      glyphId(font, "acute"),
    ]);
  });
});

// Mechanics of the TypeScript layer copy, which #789 deletes; remove with it.
describe("FontStore glyph snapshot application", () => {
  it("only materializes layer snapshots that match current font records", () => {
    const layerA = "layer_a" as LayerId;
    const layerB = "layer_b" as LayerId;
    const store = new FontStore({ workspace: workspaceWithLayer(layerA) });

    store.applyGlyphSnapshots([emptyGlyphSnapshot(layerB)]);

    expect(store.layerState(layerA)).toBeNull();
    expect(store.layerState(layerB)).toBeNull();

    store.applyGlyphSnapshots([emptyGlyphSnapshot(layerA)]);

    expect(store.layerState(layerA)).not.toBeNull();
  });
});

const GLYPH_ID = "glyph_shared" as GlyphId;
const SOURCE_ID = "source_regular" as SourceId;

function workspaceWithLayer(layerId: LayerId): WorkspaceSnapshot {
  return {
    workspaceId: "document-a",
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
    sources: [{ id: SOURCE_ID, name: "Regular", location: { values: {} }, metricValues: [] }],
    axes: [],
    axisMappings: [],
    axisMappingBases: [],
    namedInstances: [],
    languageIds: null,
    kerning: { groups: [], sources: [] },
  };
}

function emptyGlyphSnapshot(layerId: LayerId): GlyphSnapshot {
  return {
    glyphId: GLYPH_ID,
    layers: [
      {
        glyphId: GLYPH_ID,
        sourceId: SOURCE_ID,
        state: {
          layerId,
          structure: { contours: [], anchors: [], components: [] },
          values: new Float64Array(GLYPH_ADVANCE_VALUE_COUNT),
        },
      },
    ],
  };
}
