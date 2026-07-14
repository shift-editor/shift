import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const shortIdAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const shortIdLength = 10;
const shortIdAlphabetMask = shortIdAlphabet.length - 1;

function mintId(prefix) {
  const bytes = new Uint8Array(shortIdLength);
  crypto.getRandomValues(bytes);

  let suffix = "";
  for (let i = 0; i < bytes.length; i++) {
    suffix += shortIdAlphabet[bytes[i] & shortIdAlphabetMask];
  }
  return `${prefix}_${suffix}`;
}

describe("Bridge", () => {
  let bridge;
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-bridge-"));
    bridge = new Bridge();
    bridge.createUntitledWorkspace(join(tempDir, "working.sqlite"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function defaultSourceId() {
    return bridge.getSources()[0].id;
  }

  function createGlyphLayer(name = "A", unicodes = [65]) {
    const glyphId = mintId("glyph");
    const layerId = mintId("layer");
    const applied = bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name, unicodes } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: defaultSourceId() },
      },
    ]);
    const record = applied.next.glyphs.find((glyph) => glyph.id === glyphId);
    expect(record.layers).toContainEqual({ id: layerId, sourceId: defaultSourceId() });
    return layerId;
  }

  function addContour(layerId) {
    const contourId = mintId("contour");
    bridge.apply([{ kind: "addContour", addContour: { layerId, contourId, closed: false } }]);
    return contourId;
  }

  function addPoint(layerId, contourId, x, y) {
    const pointId = mintId("point");
    const applied = bridge.apply([
      {
        kind: "addPoints",
        addPoints: {
          layerId,
          contourId,
          points: [{ id: pointId, x, y, pointType: "onCurve", smooth: false }],
        },
      },
    ]);
    return { pointId, applied };
  }

  function glyphState(name) {
    const glyph = bridge.getGlyphs().find((record) => record.name === name);
    const snapshots = bridge.getGlyphSnapshots([{ glyphId: glyph.id }]);
    return snapshots[0]?.layers[0]?.state;
  }

  it("creates an untitled workspace with default committed font metadata", () => {
    expect(bridge.getMetadata()).toMatchObject({
      familyName: "Untitled Font",
      styleName: "Regular",
      versionMajor: 1,
      versionMinor: 0,
    });

    expect(bridge.getMetrics()).toEqual({ unitsPerEm: 1000 });
    const definitions = bridge.getMetricDefinitions();
    expect(definitions).toEqual([
      expect.objectContaining({ kind: "ascender", name: "Ascender" }),
      expect.objectContaining({ kind: "capHeight", name: "Cap Height" }),
      expect.objectContaining({ kind: "xHeight", name: "x-Height" }),
      expect.objectContaining({ kind: "baseline", name: "Baseline" }),
      expect.objectContaining({ kind: "descender", name: "Descender" }),
    ]);

    const [defaultSource] = bridge.getSources();
    expect(defaultSource.metricValues).toHaveLength(5);
    expect(
      definitions.map(
        ({ id }) => defaultSource.metricValues.find(({ metricId }) => metricId === id).position,
      ),
    ).toEqual([800, 700, 500, 0, -200]);

    expect(bridge.getGlyphs()).toEqual([]);
  });

  it("creates a glyph through the createGlyph intent", () => {
    const glyphId = mintId("glyph");
    const applied = bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name: "A", unicodes: [65] } },
    ]);

    const glyphs = bridge.getGlyphs();
    expect(applied.layers).toEqual([]);
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].id).toMatch(/^glyph_/);
    expect(glyphs[0].name).toBe("A");
    expect(glyphs[0].unicodes).toEqual([65]);
    expect(glyphs[0].componentBaseGlyphIds).toEqual([]);
    expect(glyphs[0].layers).toEqual([]);
  });

  it("creates a glyph layer through the createGlyphLayer intent", () => {
    const layerId = createGlyphLayer();

    const glyphs = bridge.getGlyphs();
    expect(glyphs[0].layers).toEqual([{ id: layerId, sourceId: defaultSourceId() }]);
  });

  it("exports the live workspace font through an explicit export path", async () => {
    createGlyphLayer(".notdef", []);
    const layerId = createGlyphLayer();
    const contourId = addContour(layerId);
    addPoint(layerId, contourId, 10, 20);

    const outputPath = join(tempDir, "output.ttf");
    const result = await bridge.exportWorkspace({ path: outputPath, format: "ttf" });

    expect(result).toMatchObject({ path: outputPath, format: "ttf" });
    expect(existsSync(outputPath)).toBe(true);
  });

  it("adds a point and echoes structure, values, and the client-minted ids", () => {
    const layerId = createGlyphLayer();
    const contourId = addContour(layerId);

    const { pointId, applied } = addPoint(layerId, contourId, 10, 20);

    const layer = applied.layers[0];
    expect(layer.layerId).toBe(layerId);
    expect(layer.structure.contours).toHaveLength(1);
    expect(layer.structure.contours[0]).toMatchObject({
      id: contourId,
      closed: false,
    });
    expect(layer.structure.contours[0].points).toEqual([
      {
        id: pointId,
        pointType: "onCurve",
        smooth: false,
      },
    ]);
    expect(Array.from(layer.values)).toEqual([500, 10, 20]);
  });

  it("moves points and reads them back through glyph-addressed snapshots", () => {
    const layerId = createGlyphLayer();
    const contourId = addContour(layerId);
    const { pointId } = addPoint(layerId, contourId, 10, 20);

    bridge.apply([
      {
        kind: "movePoints",
        movePoints: { layerId, pointIds: [pointId], coords: [30, 40] },
      },
    ]);

    const state = glyphState("A");
    expect(state.layerId).toBe(layerId);
    expect(Array.from(state.values)).toEqual([500, 30, 40]);
  });

  it("undoes and redoes an applied intent set", () => {
    const layerId = createGlyphLayer();
    const contourId = addContour(layerId);
    addPoint(layerId, contourId, 10, 20);

    const undone = bridge.undo();
    expect(undone.layers).toHaveLength(1);
    expect(glyphState("A").structure.contours[0].points).toHaveLength(0);

    const redone = bridge.redo();
    expect(redone.layers).toHaveLength(1);
    expect(glyphState("A").structure.contours[0].points).toHaveLength(1);
  });

  it("surfaces typed bridge errors at the NAPI boundary", () => {
    expect(() =>
      bridge.apply([
        {
          kind: "addContour",
          addContour: { layerId: "not-a-layer", contourId: mintId("contour"), closed: false },
        },
      ]),
    ).toThrow(/layer ID/i);

    const layerId = createGlyphLayer();
    expect(() =>
      bridge.apply([
        {
          kind: "addPoints",
          addPoints: {
            layerId,
            contourId: "not-a-contour",
            points: [{ id: mintId("point"), x: 10, y: 20, pointType: "onCurve", smooth: false }],
          },
        },
      ]),
    ).toThrow(/contour ID/i);
  });
});
