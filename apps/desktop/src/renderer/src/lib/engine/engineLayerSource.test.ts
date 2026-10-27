import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, type ShiftBridge } from "@shift/bridge";
import {
  mintAnchorId,
  mintComponentId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  type FontIntent,
  type LayerId,
  type PointId,
} from "@shift/types";
import { loadEngine, type EngineSession } from "@shift/editor/model";
import { layerReaderHost } from "../../../../preload/layerReaders";
import { engineLayerSource } from "./engineLayerSource";

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
  let layerId: LayerId;
  let pointIds: PointId[];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-engine-source-"));
    const storePath = path.join(dir, "working.sqlite");
    bridge = createBridge();
    bridge.createUntitledWorkspace(storePath);
    const glyphId = mintGlyphId();
    layerId = mintLayerId();
    const contourId = mintContourId();
    pointIds = [mintPointId(), mintPointId(), mintPointId()];
    bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name: "A", unicodes: [65] } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: bridge.getSources()[0]!.id },
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

    const layers = layerReaderHost();
    const reader = layers.open({ kind: "working", storePath });
    openEngine = async () => {
      const { EngineSession } = await loadEngine();
      return EngineSession.open(
        bridge.encodedDirectory(),
        engineLayerSource(layers, () => reader),
      );
    };
    engine = await openEngine();
  });

  afterEach(() => {
    engine.dispose();
    bridge.closeWorkspace();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** What `intent` does in the engine, as one edit. */
  function edit(intent: FontIntent) {
    engine.beginEdit();
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
    const glyphId = bridge.getGlyphs()[0]!.id;
    const sourceId = bridge.getSources()[0]!.id;
    const edits: FontIntent[] = [
      {
        kind: "setKerningValues",
        setKerningValues: {
          edits: [
            {
              sourceId,
              first: { kind: "glyph", id: glyphId },
              second: { kind: "glyph", id: glyphId },
              amount: -40,
            },
          ],
        },
      },
      {
        kind: "updateFontMetadata",
        updateFontMetadata: { metadata: { ...bridge.getMetadata(), familyName: "Parity Sans" } },
      },
      { kind: "setLanguages", setLanguages: { languageIds: ["en", "fr"] } },
    ];

    for (const intent of edits) {
      const fromEngine = edit(intent).next;
      const fromWorkspace = bridge.apply([intent]).next;
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
    const source = bridge.getSources()[0]!.id;
    const glyph = (name: string) => {
      const glyphId = mintGlyphId();
      const glyphLayer = mintLayerId();
      bridge.apply([
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
    bridge.apply([
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
      bridge.apply([
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
});

/** `value` as JSON would carry it: typed arrays as arrays, absent fields dropped. */
function asJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, field: unknown) =>
      field instanceof Float64Array ? [...field] : field,
    ),
  );
}
