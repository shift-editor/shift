import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

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

  function defaultUnicode(name, unicode) {
    return unicode ?? (name === "A" ? 65 : undefined);
  }

  function createDefaultLayer(name = "A", unicode) {
    const resolvedUnicode = defaultUnicode(name, unicode);
    const unicodes = resolvedUnicode === undefined ? [] : [resolvedUnicode];
    const glyphId = bridge.createGlyph(name, unicodes);
    return bridge.createGlyphLayer(glyphId, defaultSourceId());
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

    expect(bridge.getGlyphCount()).toBe(0);
    expect(bridge.getGlyphs()).toEqual([]);
  });

  it("closes the active workspace", () => {
    bridge.closeWorkspace();

    expect(() => bridge.getMetadata()).toThrow(/no workspace is open/i);
  });

  it("creates a new glyph through an explicit layer edit", () => {
    bridge.setXAdvance(createDefaultLayer(), 500);

    const glyphs = bridge.getGlyphs();
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].id).toMatch(/^glyph_/);
    expect(glyphs[0].name).toBe("A");
    expect(glyphs[0].unicodes).toEqual([65]);
    expect(glyphs[0].componentBaseGlyphNames).toEqual([]);
  });

  it("saves direct glyph layer edits to a shift source package target", () => {
    const layerId = createDefaultLayer();
    const contourId = bridge.addContour(layerId).changed.contourIds[0];
    bridge.addPoint(layerId, contourId, 10, 20, "onCurve", false);

    const outputPath = join(tempDir, "output.shift");
    const savedVersion = bridge.saveWorkspaceAs(outputPath);

    expect(bridge.getPersistedVersion()).toBe(4);
    expect(bridge.isDirty()).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("records the persisted version when saving the current workspace", () => {
    const layerId = createDefaultLayer();
    bridge.saveWorkspaceAs(join(tempDir, "saved.shift"));
    bridge.addContour(layerId);

    const savedVersion = bridge.saveWorkspace();

    expect(savedVersion).toBe(3);
    expect(bridge.getPersistedVersion()).toBe(3);
    expect(bridge.isDirty()).toBe(false);
  });

  it("exports the live workspace font through an explicit export path", async () => {
    createDefaultLayer(".notdef", undefined);
    const layerId = createDefaultLayer();
    const contourId = bridge.addContour(layerId).changed.contourIds[0];
    bridge.addPoint(layerId, contourId, 10, 20, "onCurve", false);

    const outputPath = join(tempDir, "output.ttf");
    const result = await bridge.exportWorkspace({ path: outputPath, format: "ttf" });

    expect(result).toMatchObject({ path: outputPath, format: "ttf" });
    expect(existsSync(outputPath)).toBe(true);
  });

  it("adds a point to a contour and returns structure, values, and changed ids", () => {
    const layerId = createDefaultLayer();
    const contourChange = bridge.addContour(layerId);
    const contourId = contourChange.changed.contourIds[0];

    const change = bridge.addPoint(layerId, contourId, 10, 20, "onCurve", false);

    expect(change.changed.pointIds).toHaveLength(1);
    expect(change.structure.contours).toHaveLength(1);
    expect(change.structure.contours[0]).toMatchObject({
      id: contourId,
      closed: false,
    });
    expect(change.structure.contours[0].points).toEqual([
      {
        id: change.changed.pointIds[0],
        pointType: "onCurve",
        smooth: false,
      },
    ]);
    expect(Array.from(change.values)).toEqual([500, 10, 20]);
  });

  it("applies point positions through the sparse bridge patch path", () => {
    const layerId = createDefaultLayer();
    const contourId = bridge.addContour(layerId).changed.contourIds[0];
    const pointId = bridge.addPoint(layerId, contourId, 10, 20, "onCurve", false).changed
      .pointIds[0];

    bridge.applyPositionPatch(layerId, [pointId], new Float64Array([30, 40]), null, null);

    const state = bridge.getGlyphState({ name: "A", unicode: 65 }, defaultSourceId());
    expect(state.layerId).toBe(layerId);
    expect(Array.from(state.values)).toEqual([500, 30, 40]);
  });

  it("restores structure and values into a glyph layer", () => {
    const layerId = createDefaultLayer();
    const contourId = bridge.addContour(layerId).changed.contourIds[0];
    const before = bridge.addPoint(layerId, contourId, 10, 20, "onCurve", false);
    const pointId = before.changed.pointIds[0];

    const change = bridge.restoreState(layerId, before.structure, new Float64Array([700, 90, 120]));

    expect(change.structure.contours[0].points[0].id).toBe(pointId);
    expect(Array.from(change.values)).toEqual([700, 90, 120]);
  });

  it("surfaces typed bridge errors at the NAPI boundary", () => {
    expect(() => bridge.addContour("not-a-layer")).toThrow(/layer ID/i);

    const layerId = createDefaultLayer();
    expect(() => bridge.addPoint(layerId, "not-a-contour", 10, 20, "onCurve", false)).toThrow(
      /contour ID/i,
    );
    expect(() =>
      bridge.applyPositionPatch(layerId, ["not-a-point"], new Float64Array([10]), null, null),
    ).toThrow(/point ID/i);
  });
});
