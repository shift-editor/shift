import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge, LayerReader } = require("../index.js");

let counter = 0;
const mintId = (prefix) => `${prefix}_reader${String(counter++).padStart(4, "0")}`;
const text = (bytes) => new TextDecoder().decode(bytes);

describe("LayerReader", () => {
  let bridge;
  let tempDir;
  let storePath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-layer-reader-"));
    storePath = join(tempDir, "working.sqlite");
    bridge = new Bridge();
    bridge.createUntitledWorkspace(storePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createGlyph(name) {
    const glyphId = mintId("glyph");
    const layerId = mintId("layer");
    bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name, unicodes: [] } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: bridge.getSources()[0].id },
      },
    ]);
    return { glyphId, layerId };
  }

  function addPoint(layerId, contourId, x) {
    const pointId = mintId("point");
    bridge.apply([
      {
        kind: "addPoints",
        addPoints: {
          layerId,
          contourId,
          points: [{ id: pointId, x, y: 0, pointType: "onCurve", smooth: false }],
        },
      },
    ]);
    return pointId;
  }

  it("reads layers as the workspace writes them", () => {
    const { layerId } = createGlyph("A");
    const contourId = mintId("contour");
    bridge.apply([{ kind: "addContour", addContour: { layerId, contourId, closed: false } }]);
    const first = addPoint(layerId, contourId, 10);

    const reader = LayerReader.openWorkingStore(storePath);
    const bytes = reader.loadLayers([layerId]);
    // A MessagePack array of one named-field layer.
    expect(bytes[0]).toBe(0x91);
    expect(text(bytes)).toContain(layerId);
    expect(text(bytes)).toContain(first);

    const second = addPoint(layerId, contourId, 20);
    expect(text(reader.loadLayers([layerId]))).toContain(second);
  });

  it("answers which glyphs a composite uses and which composites use a glyph", () => {
    const base = createGlyph("base");
    const composite = createGlyph("composite");
    bridge.apply([
      {
        kind: "addComponent",
        addComponent: {
          layerId: composite.layerId,
          componentId: mintId("component"),
          baseGlyphId: base.glyphId,
        },
      },
    ]);

    const reader = LayerReader.openWorkingStore(storePath);
    expect(reader.componentClosure([composite.glyphId]).sort()).toEqual(
      [base.glyphId, composite.glyphId].sort(),
    );
    expect(reader.dependents([base.layerId])).toEqual([composite.glyphId]);
  });

  it("rejects ids that are not layer ids", () => {
    const reader = LayerReader.openWorkingStore(storePath);
    expect(() => reader.loadLayers(["not an id"])).toThrow(/layer ID/);
  });
});
