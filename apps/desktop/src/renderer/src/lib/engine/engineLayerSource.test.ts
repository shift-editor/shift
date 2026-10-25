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
 * The window's engine and the native workspace, given the same intent on the
 * same store, return the same layers: the engine replaces the renderer's own
 * copy of the editing rules without changing what an edit does.
 */
describe("the editing engine edits as the native workspace does", () => {
  let dir: string;
  let bridge: ShiftBridge;
  let engine: EngineSession;
  let openEngine: () => Promise<EngineSession>;
  let layerId: LayerId;
  let pointIds: PointId[];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-engine-parity-"));
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
      return EngineSession.open(layers.directory(reader), engineLayerSource(layers, reader));
    };
    engine = await openEngine();
  });

  afterEach(() => {
    engine.dispose();
    bridge.closeWorkspace();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Applies `intent` to the engine, then to the workspace, and returns both results. */
  function both(intent: FontIntent) {
    const fromEngine = engine.apply([intent]).find((layer) => layer.layerId === layerId);
    const fromNative = bridge.apply([intent]).layers.find((layer) => layer.layerId === layerId);
    return { fromEngine, fromNative };
  }

  it("moves points to the same values", () => {
    const { fromEngine, fromNative } = both({
      kind: "movePoints",
      movePoints: { layerId, pointIds: [pointIds[1]!], coords: [175, 260] },
    });

    expect(fromEngine?.structural).toBe(false);
    expect([...fromEngine!.values]).toEqual([...fromNative!.values]);
  });

  it("removes points to the same structure and values", () => {
    const { fromEngine, fromNative } = both({
      kind: "removePoints",
      removePoints: { layerId, pointIds: [pointIds[0]!] },
    });

    expect(fromEngine?.structural).toBe(true);
    expect(fromEngine?.structure).toEqual(fromNative?.structure);
    expect([...fromEngine!.values]).toEqual([...fromNative!.values]);
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

    const intent: FontIntent = {
      kind: "moveAnchors",
      moveAnchors: { layerId: base.layerId, anchorIds: [top], coords: [260, 720] },
    };
    const fromEngine = engine.apply([intent]).find((layer) => layer.layerId === composite.layerId);
    const fromNative = bridge
      .apply([intent])
      .layers.find((layer) => layer.layerId === composite.layerId);

    expect(fromEngine, "the engine moves the composite").toBeDefined();
    expect([...fromEngine!.values]).toEqual([...fromNative!.values]);
  });
});
