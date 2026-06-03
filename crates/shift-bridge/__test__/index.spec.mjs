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
    bridge.createWorkspace(join(tempDir, "TestFont.shift"), join(tempDir, "working.sqlite"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function defaultSourceId() {
    return bridge.getSources()[0].id;
  }

  function defaultLayerRef(name = "A", unicode = 65) {
    return {
      glyphHandle: { name, unicode },
      layerId: bridge.getSources()[0].layerId,
    };
  }

  it("creates a workspace with default committed font metadata", () => {
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

  it("creates a new glyph through an explicit layer edit", () => {
    bridge.setXAdvance(defaultLayerRef(), 500);

    expect(bridge.getGlyphs()).toEqual([
      { name: "A", unicodes: [65], componentBaseGlyphNames: [] },
    ]);
  });

  it("saves direct glyph layer edits to a shift source package target", () => {
    const glyphRef = defaultLayerRef();
    const contourId = bridge.addContour(glyphRef).changed.contourIds[0];
    bridge.addPoint(glyphRef, contourId, 10, 20, "onCurve", false);

    const outputPath = join(tempDir, "output.shift");
    const savedVersion = bridge.saveWorkspaceAs(outputPath);

    expect(savedVersion).toBe(2);
    expect(bridge.getPersistedVersion()).toBe(2);
    expect(bridge.isDirty()).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("records the persisted version when saving the current workspace", () => {
    bridge.addContour(defaultLayerRef());

    const savedVersion = bridge.saveWorkspace();

    expect(savedVersion).toBe(1);
    expect(bridge.getPersistedVersion()).toBe(1);
    expect(bridge.isDirty()).toBe(false);
  });

  it("exports the live workspace font through an explicit export path", async () => {
    const glyphRef = defaultLayerRef();
    const contourId = bridge.addContour(glyphRef).changed.contourIds[0];
    bridge.addPoint(glyphRef, contourId, 10, 20, "onCurve", false);

    const outputPath = join(tempDir, "output.ttf");
    const result = await bridge.exportWorkspace({ path: outputPath, format: "ttf" });

    expect(result).toMatchObject({ path: outputPath, format: "ttf" });
    expect(existsSync(outputPath)).toBe(true);
  });

  it("adds a point to a contour and returns structure, values, and changed ids", () => {
    const glyphRef = defaultLayerRef();
    const contourChange = bridge.addContour(glyphRef);
    const contourId = contourChange.changed.contourIds[0];

    const change = bridge.addPoint(glyphRef, contourId, 10, 20, "onCurve", false);

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

  it("applies point positions through the sparse typed-array hot path", () => {
    const glyphRef = defaultLayerRef();
    const contourId = bridge.addContour(glyphRef).changed.contourIds[0];
    const pointId = bridge.addPoint(glyphRef, contourId, 10, 20, "onCurve", false).changed
      .pointIds[0];

    bridge.applyPositionPatch(
      glyphRef,
      new BigUint64Array([BigInt(pointId)]),
      new Float64Array([30, 40]),
      null,
      null,
    );

    const state = bridge.getGlyphState(
      { name: "A", unicode: 65 },
      defaultSourceId(),
    );
    expect(Array.from(state.values)).toEqual([500, 30, 40]);
  });

  it("restores structure and values into a glyph layer", () => {
    const glyphRef = defaultLayerRef();
    const contourId = bridge.addContour(glyphRef).changed.contourIds[0];
    const before = bridge.addPoint(glyphRef, contourId, 10, 20, "onCurve", false);
    const pointId = before.changed.pointIds[0];

    const change = bridge.restoreState(
      glyphRef,
      before.structure,
      new Float64Array([700, 90, 120]),
    );

    expect(change.structure.contours[0].points[0].id).toBe(pointId);
    expect(Array.from(change.values)).toEqual([700, 90, 120]);
  });

  it("surfaces typed bridge errors at the NAPI boundary", () => {
    expect(() =>
      bridge.addContour({ glyphHandle: { name: "A", unicode: 65 }, layerId: "not-a-layer" }),
    ).toThrow(/layer ID/i);

    const glyphRef = defaultLayerRef();
    expect(() =>
      bridge.addPoint(glyphRef, "not-a-contour", 10, 20, "onCurve", false),
    ).toThrow(/contour ID/i);
    expect(() =>
      bridge.applyPositionPatch(
        glyphRef,
        new BigUint64Array([1n]),
        new Float64Array([10]),
        null,
        null,
      ),
    ).toThrow(/point positions/i);
  });
});
