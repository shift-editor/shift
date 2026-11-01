import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, type ShiftBridge } from "@shift/bridge";
import {
  mintAnchorId,
  mintAxisId,
  mintComponentId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  mintSourceId,
  type FontIntent,
  type GlyphId,
  type LayerId,
  type PointId,
  type SourceId,
} from "@shift/types";
import type { Counterparts } from "@shift/wasm/protocol";
import { loadEngine, type EngineSession } from "@shift/editor/model";
import { layerReaderHost } from "../../../../preload/layerReaders";
import { engineStoreRequest } from "./engineStoreRequest";

/**
 * The window's engine edits a real store through the preload's reader: the
 * directory opens it, layers load on the edit that reads them, and each
 * touched layer comes back in the echo's shape. The editing rules themselves
 * are shift-font's, tested there and in shift-engine; this covers the wiring.
 * The native bridge only writes the store the engine reads.
 */
describe("the window's engine edits from the store", () => {
  let dir: string;
  let bridge: ShiftBridge;
  let engine: EngineSession;
  let openEngine: () => Promise<EngineSession>;
  let glyphId: GlyphId;
  let layerId: LayerId;
  let pointIds: PointId[];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-engine-source-"));
    const storePath = path.join(dir, "working.sqlite");
    bridge = createBridge();
    bridge.workspace.createUntitledWorkspace(storePath);
    const layers = layerReaderHost();
    const reader = layers.open({ kind: "working", storePath });
    openEngine = async () => {
      const { EngineSession } = await loadEngine();
      return EngineSession.open(
        bridge.workspace.encodedDirectory(),
        engineStoreRequest(layers, () => reader),
      );
    };
    const blank = await openEngine();
    const sourceId = blank.fontRecords().sources[0]!.id;
    blank.dispose();
    glyphId = mintGlyphId();
    layerId = mintLayerId();
    const contourId = mintContourId();
    pointIds = [mintPointId(), mintPointId(), mintPointId()];
    bridge.workspace.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name: "A", unicodes: [65] } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId },
      },
      { kind: "addContour", addContour: { layerId, contourId, closed: true } },
      {
        kind: "addPoints",
        addPoints: {
          layerId,
          contourId,
          points: pointIds.map((id, index) => ({
            id,
            x: index * 100,
            y: index * 50,
            pointType: "onCurve" as const,
            smooth: false,
          })),
        },
      },
    ]);

    engine = await openEngine();
  });

  afterEach(() => {
    engine.dispose();
    bridge.workspace.closeWorkspace();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** What `intent` does in the engine, as one edit. */
  function edit(intent: FontIntent) {
    engine.beginEdit(null);
    const done = engine.apply([intent]);
    engine.endEdit();
    return done;
  }

  /** The layer `intent` leaves `id` as, from the engine. */
  function applied(intent: FontIntent, id: LayerId = layerId) {
    return edit(intent).layers.find((layer) => layer.layerId === id);
  }

  /** Whether `values` holds the coordinate pair `x, y`. */
  function holdsPair(values: Float64Array, x: number, y: number): boolean {
    return values.some((value, index) => value === x && values[index + 1] === y);
  }

  it("returns the same font-level records the workspace echoes for the edit", () => {
    const glyphId = bridge.workspace.getGlyphs()[0]!.id;
    const sourceId = engine.fontRecords().sources[0]!.id;
    const edits: FontIntent[] = [
      {
        kind: "setKerningValues",
        setKerningValues: {
          edits: [
            {
              sourceId,
              pair: {
                first: { kind: "glyph", glyph: glyphId },
                second: { kind: "glyph", glyph: glyphId },
              },
              value: -40,
            },
          ],
        },
      },
      {
        kind: "updateFontMetadata",
        updateFontMetadata: {
          metadata: { ...bridge.workspace.getMetadata(), familyName: "Parity Sans" },
        },
      },
      { kind: "setLanguages", setLanguages: { languageIds: ["en", "fr"] } },
    ];

    for (const intent of edits) {
      const fromEngine = edit(intent).next;
      const fromWorkspace = bridge.workspace.apply([intent]).next;
      expect(Object.keys(asJson(fromEngine) as object)).not.toHaveLength(0);
      expect(asJson(fromEngine)).toEqual(asJson({ ...fromWorkspace, glyphs: undefined }));
    }
  });

  it("loads the edited layer and returns its moved values", () => {
    const layer = applied({
      kind: "movePoints",
      movePoints: { layerId, pointIds: [pointIds[1]!], coords: [175, 260] },
    });

    expect(layer?.structural).toBe(false);
    expect(layer?.structure).toBeNull();
    expect(holdsPair(layer!.values, 175, 260)).toBe(true);
  });

  it("returns a structural change with the new structure", () => {
    const layer = applied({
      kind: "removePoints",
      removePoints: { layerId, pointIds: [pointIds[0]!] },
    });

    expect(layer?.structural).toBe(true);
    const [contour] = layer?.structure?.contours ?? [];
    expect(contour && "points" in contour ? contour.points.map((point) => point.id) : null).toEqual(
      pointIds.slice(1),
    );
  });

  it("sends a contour a structural edit kept by its id alone", () => {
    // The first edit loads the layer, which the engine then sends whole.
    applied({ kind: "setXAdvance", setXAdvance: { layerId, width: 640 } });
    const contourId = mintContourId();
    const layer = applied({
      kind: "addContour",
      addContour: { layerId, contourId, closed: false },
    });

    expect(layer?.structural).toBe(true);
    expect(layer?.structure?.contours).toEqual([
      { id: expect.any(String), kept: true },
      { id: contourId, points: [], closed: false },
    ]);
  });

  it("moves the composites attached to a moved anchor", async () => {
    const source = engine.fontRecords().sources[0]!.id;
    const glyph = (name: string) => {
      const glyphId = mintGlyphId();
      const glyphLayer = mintLayerId();
      bridge.workspace.apply([
        { kind: "createGlyph", createGlyph: { glyphId, name, unicodes: [] } },
        {
          kind: "createGlyphLayer",
          createGlyphLayer: { layerId: glyphLayer, glyphId, sourceId: source },
        },
      ]);
      return { glyphId, layerId: glyphLayer };
    };
    const base = glyph("base");
    const mark = glyph("mark");
    const composite = glyph("composite");
    const top = mintAnchorId();
    bridge.workspace.apply([
      {
        kind: "addAnchors",
        addAnchors: { layerId: base.layerId, anchors: [{ id: top, name: "top", x: 200, y: 700 }] },
      },
      {
        kind: "addAnchors",
        addAnchors: {
          layerId: mark.layerId,
          anchors: [{ id: mintAnchorId(), name: "_top", x: 50, y: 0 }],
        },
      },
    ]);
    for (const glyphId of [base.glyphId, mark.glyphId]) {
      bridge.workspace.apply([
        {
          kind: "addComponent",
          addComponent: {
            layerId: composite.layerId,
            componentId: mintComponentId(),
            baseGlyphId: glyphId,
          },
        },
      ]);
    }

    // The glyphs were created natively after the engine opened; reopen it on
    // the directory as it now stands, with every layer still unloaded.
    engine.dispose();
    engine = await openEngine();

    const layer = applied(
      {
        kind: "moveAnchors",
        moveAnchors: { layerId: base.layerId, anchorIds: [top], coords: [260, 720] },
      },
      composite.layerId,
    );

    // The mark's `_top` (50, 0) now sits on the base's moved `top` (260, 720).
    expect(layer, "the engine loads and moves the composite").toBeDefined();
    expect(holdsPair(layer!.values, 210, 720)).toBe(true);
  });

  describe("matching the layers of two sources", () => {
    let boldId: SourceId;
    let boldLayerId: LayerId;
    let boldPointIds: PointId[];

    beforeEach(async () => {
      const axisId = mintAxisId();
      const contourId = mintContourId();
      boldId = mintSourceId();
      boldLayerId = mintLayerId();
      boldPointIds = [mintPointId(), mintPointId(), mintPointId()];
      bridge.workspace.apply([
        {
          kind: "createAxis",
          createAxis: {
            axis: {
              id: axisId,
              tag: "wght",
              name: "Weight",
              role: "external",
              kind: { kind: "continuous", minimum: 400, default: 400, maximum: 700 },
              labels: [],
              hidden: false,
            },
          },
        },
        {
          kind: "createSource",
          createSource: { sourceId: boldId, name: "Bold", location: { values: { [axisId]: 700 } } },
        },
        {
          kind: "createGlyphLayer",
          createGlyphLayer: { layerId: boldLayerId, glyphId, sourceId: boldId },
        },
        { kind: "addContour", addContour: { layerId: boldLayerId, contourId, closed: true } },
        {
          kind: "addPoints",
          addPoints: {
            layerId: boldLayerId,
            contourId,
            points: boldPointIds.map((id, index) => ({
              id,
              x: index * 120,
              y: index * 60,
              pointType: "onCurve" as const,
              smooth: false,
            })),
          },
        },
      ]);
      engine.dispose();
      engine = await openEngine();
      engine.preload([glyphId]);
    });

    it("names the Bold points matching the Regular ones, in the order asked", () => {
      const counterparts = engine.counterparts(
        layerId,
        boldLayerId,
        pointsOnly(pointIds[2]!, pointIds[0]!),
      );

      expect(counterparts).toEqual(pointsOnly(boldPointIds[2]!, boldPointIds[0]!));
    });

    it("names none once the outlines match but the anchors no longer do", () => {
      edit({
        kind: "addAnchors",
        addAnchors: {
          layerId: boldLayerId,
          anchors: [{ id: mintAnchorId(), name: "top", x: 60, y: 300 }],
        },
      });

      expect(engine.counterparts(layerId, boldLayerId, pointsOnly(...pointIds))).toBeNull();
    });

    it("names none once the Bold contour has a point fewer", () => {
      edit({
        kind: "removePoints",
        removePoints: { layerId: boldLayerId, pointIds: [boldPointIds[1]!] },
      });

      expect(engine.counterparts(layerId, boldLayerId, pointsOnly(pointIds[0]!))).toBeNull();
    });

    it("says why it cannot match a point Regular lacks, or layers of two glyphs", () => {
      const point = mintPointId();
      const otherGlyphId = mintGlyphId();
      const otherLayerId = mintLayerId();
      edit({
        kind: "createGlyph",
        createGlyph: { glyphId: otherGlyphId, name: "B", unicodes: [] },
      });
      edit({
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId: otherLayerId, glyphId: otherGlyphId, sourceId: boldId },
      });

      expect(() => engine.counterparts(layerId, boldLayerId, pointsOnly(point))).toThrow(
        expect.objectContaining({
          error: { kind: "font", error: { kind: "unknownPoint", point } },
        }),
      );
      expect(() => engine.counterparts(layerId, otherLayerId, pointsOnly())).toThrow(
        expect.objectContaining({
          error: {
            kind: "font",
            error: { kind: "differentGlyphs", reference: layerId, target: otherLayerId },
          },
        }),
      );
    });

    it("refuses a layer it has not loaded", async () => {
      engine.dispose();
      engine = await openEngine();

      expect(() => engine.counterparts(layerId, boldLayerId, pointsOnly())).toThrow(
        expect.objectContaining({ error: { kind: "notLoaded", layer: layerId } }),
      );
    });
  });
});

/** `value` as JSON would carry it: typed arrays as arrays, absent fields dropped. */
function asJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, field: unknown) =>
      field instanceof Float64Array ? [...field] : field,
    ),
  );
}

/** A counterparts request, or answer, naming only `points`. */
function pointsOnly(...points: PointId[]): Counterparts {
  return { points, anchors: [], components: [] };
}
