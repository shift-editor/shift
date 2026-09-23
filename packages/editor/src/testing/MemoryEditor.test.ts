import { describe, expect, it } from "vitest";
import {
  asAxisId,
  asContourId,
  asGlyphId,
  asLayerId,
  asPointId,
  asSourceId,
  mintNodeId,
  type AxisId,
  type FontSnapshot,
  type GlyphRecord,
  type GlyphSnapshot,
} from "@shift/types";
import { createMemoryFontSession } from "../createMemoryFontSession";
import type { SystemClipboard } from "../lib/clipboard";
import { externalAxisLocationFromRecord } from "../lib/variation/location";
import type { ScenePoint } from "../types/coordinates";
import type { MemoryFontSource } from "../types/fontSession";

const glyphId = asGlyphId("glyph_s");
const regularSourceId = asSourceId("source_regular");
const boldSourceId = asSourceId("source_bold");
const regularLayerId = asLayerId("layer_regular");
const boldLayerId = asLayerId("layer_bold");
const regularPointId = asPointId("point_regular_start");
const regularEndPointId = asPointId("point_regular_end");
const boldPointId = asPointId("point_bold_start");
const boldEndPointId = asPointId("point_bold_end");
const axisId = asAxisId("axis_weight");

class MemoryClipboard implements SystemClipboard {
  #value = "";

  writeText(value: string): Promise<void> {
    this.#value = value;
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return Promise.resolve(this.#value);
  }
}

describe("memory font editing", () => {
  it("loads snapshots and retains a Select-tool point drag in memory", async () => {
    const { font: fontSnapshot, glyph, records } = fixture();
    const source = memorySource({ font: fontSnapshot, glyph, records });
    const session = createMemoryFontSession({ source, clipboard: new MemoryClipboard() });
    const { editor, font } = session;

    expect(editor.scene.nodes()).toEqual([]);

    editor.selectSource(regularSourceId);
    const loadedGlyph = await font.loadGlyph(glyphId);
    editor.scene.setNodes([
      {
        id: mintNodeId(),
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId,
        sourceId: regularSourceId,
        position: { x: 0, y: 0 },
      },
    ]);

    const midpoint = externalAxisLocationFromRecord({ [axisId]: 500 });
    expect(loadedGlyph.geometryAt(midpoint).point(regularPointId)).toMatchObject({
      x: 200,
      y: 100,
    });

    expect(editor.getPointerTarget({ x: 100, y: 100 } as ScenePoint).kind).toBe("point");
    expect(editor.positionSelection([regularPointId])).not.toBeNull();

    const down = editor.projectSceneToScreen({ x: 100, y: 100 });
    const start = editor.projectSceneToScreen({ x: 104, y: 100 });
    const end = editor.projectSceneToScreen({ x: 150, y: 125 });
    const modifiers = { shiftKey: false, altKey: false, metaKey: false };

    editor.toolManager.handlePointerDown(down, modifiers);
    editor.toolManager.handlePointerMove(start, modifiers, { force: true });
    editor.toolManager.flushPointerMoves();
    editor.toolManager.handlePointerMove(end, modifiers, { force: true });
    editor.toolManager.flushPointerMoves();
    editor.toolManager.handlePointerUp(end, modifiers);

    expect(loadedGlyph.layerForSource(regularSourceId)?.point(regularPointId)).toMatchObject({
      x: 150,
      y: 125,
    });
    expect(loadedGlyph.geometryAt(midpoint).point(regularPointId)).toMatchObject({
      x: 225,
      y: 112.5,
    });

    session.dispose();
  });

  it("keeps axis state isolated between independent editor sessions", () => {
    const source = memorySource(fixture());
    const first = createMemoryFontSession({ source, clipboard: new MemoryClipboard() });
    const second = createMemoryFontSession({ source, clipboard: new MemoryClipboard() });
    const secondLocation = second.editor.externalLocation;

    first.editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 625 }));

    expect(first.editor.externalLocation.get(axisId)).toBe(625);
    expect(second.editor.externalLocation).toBe(secondLocation);
    expect(second.editor.externalLocation.has(axisId)).toBe(false);

    first.dispose();
    second.dispose();
  });

  it("disposes a session idempotently", () => {
    const session = createMemoryFontSession({
      source: memorySource(fixture()),
      clipboard: new MemoryClipboard(),
    });
    let destroyingEvents = 0;
    session.editor.on("destroying", () => {
      destroyingEvents += 1;
    });

    session.dispose();
    session.dispose();

    expect(destroyingEvents).toBe(1);
  });
});

function memorySource({ font, glyph, records }: ReturnType<typeof fixture>): MemoryFontSource {
  return {
    font,
    records,
    read(glyphIds) {
      return Promise.resolve(glyphIds.includes(glyph.glyphId) ? [glyph] : []);
    },
    glyphPreviews() {
      return Promise.resolve([]);
    },
  };
}

function fixture(): {
  font: FontSnapshot;
  glyph: GlyphSnapshot;
  records: readonly GlyphRecord[];
} {
  const regularStructure = {
    contours: [
      {
        id: asContourId("contour_regular"),
        closed: false,
        points: [
          { id: regularPointId, pointType: "onCurve" as const, smooth: false },
          { id: regularEndPointId, pointType: "onCurve" as const, smooth: false },
        ],
      },
    ],
    anchors: [],
    components: [],
  };
  const boldStructure = {
    contours: [
      {
        id: asContourId("contour_bold"),
        closed: false,
        points: [
          { id: boldPointId, pointType: "onCurve" as const, smooth: false },
          { id: boldEndPointId, pointType: "onCurve" as const, smooth: false },
        ],
      },
    ],
    anchors: [],
    components: [],
  };
  const regularValues = new Float64Array([500, 100, 100, 300, 100]);
  const boldValues = new Float64Array([500, 300, 100, 500, 100]);

  return {
    font: {
      metadata: { familyName: "Memory Test" },
      metrics: { unitsPerEm: 1000 },
      metricDefinitions: [],
      glyphs: [{ id: glyphId, name: "S", unicodes: [83] }],
      sources: [
        {
          id: regularSourceId,
          name: "Regular",
          location: { values: { [axisId]: 0 } as Record<AxisId, number> },
          metricValues: [],
        },
        {
          id: boldSourceId,
          name: "Bold",
          location: { values: { [axisId]: 1000 } as Record<AxisId, number> },
          metricValues: [],
        },
      ],
      axes: [
        {
          id: axisId,
          tag: "wght",
          name: "Weight",
          role: "external",
          axisType: "continuous",
          minimum: 0,
          default: 0,
          maximum: 1000,
          labels: [],
          hidden: false,
        },
      ],
      axisMappings: [],
      axisMappingBases: [],
      namedInstances: [],
    },
    records: [
      {
        id: glyphId,
        name: "S" as GlyphRecord["name"],
        unicodes: [83 as GlyphRecord["unicodes"][number]],
        componentBaseGlyphIds: [],
        layers: [
          { id: regularLayerId, sourceId: regularSourceId },
          { id: boldLayerId, sourceId: boldSourceId },
        ],
      },
    ],
    glyph: {
      glyphId,
      projection: {
        glyphId,
        fallback: {
          structure: regularStructure,
          values: regularValues,
          componentTransformKind: "decomposed",
        },
        interpolation: {
          basis: {
            sourceIds: [regularSourceId, boldSourceId],
            basis: {
              deltas: [
                { region: [], values: new Float64Array([1, 0]) },
                {
                  region: [{ axisId, lower: 0, peak: 1, upper: 1 }],
                  values: new Float64Array([-1, 1]),
                },
              ],
            },
          },
          sources: [
            { sourceId: regularSourceId, values: regularValues },
            { sourceId: boldSourceId, values: boldValues },
          ],
        },
        exactSourceShapes: [],
        components: { rootGlyphId: glyphId, components: [] },
        exactSourceComponents: [],
        componentGlyphIds: [],
      },
      layers: [
        {
          glyphId,
          sourceId: regularSourceId,
          state: { layerId: regularLayerId, structure: regularStructure, values: regularValues },
        },
        {
          glyphId,
          sourceId: boldSourceId,
          state: { layerId: boldLayerId, structure: boldStructure, values: boldValues },
        },
      ],
    },
  };
}
