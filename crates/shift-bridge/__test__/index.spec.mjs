import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const mintId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

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
    const applied = bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId: mintId("glyph"), name, unicodes } },
    ]);
    return applied.layers[0].layerId;
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
    return bridge.getGlyph(glyph.id, defaultSourceId());
  }

  it("creates an untitled workspace with default committed font metadata", () => {
    expect(bridge.getMetadata()).toMatchObject({
      familyName: "Untitled Font",
      styleName: "Regular",
      versionMajor: 1,
      versionMinor: 0,
    });

    expect(bridge.getMetrics()).toMatchObject({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
    });

    expect(bridge.getGlyphs()).toEqual([]);
  });

  it("creates a glyph through the createGlyph intent", () => {
    createGlyphLayer();

    const glyphs = bridge.getGlyphs();
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].id).toMatch(/^glyph_/);
    expect(glyphs[0].name).toBe("A");
    expect(glyphs[0].unicodes).toEqual([65]);
    expect(glyphs[0].componentBaseGlyphIds).toEqual([]);
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

  it("moves points and reads them back through the id-addressed glyph state", () => {
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
