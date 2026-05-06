import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

describe("Bridge", () => {
  let bridge;

  beforeEach(() => {
    bridge = new Bridge();
  });

  function defaultSourceId() {
    return bridge.getSources()[0].id;
  }

  it("starts with default committed font metadata", () => {
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

  it("commits a new glyph when the edit session ends", () => {
    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
    expect(bridge.hasEditSession()).toBe(true);
    expect(bridge.getEditingGlyphName()).toBe("A");
    expect(bridge.getEditingSourceId()).toBe(defaultSourceId());
    expect(bridge.getEditingUnicode()).toBe(65);

    bridge.endEditSession();

    expect(bridge.hasEditSession()).toBe(false);
    expect(bridge.getGlyphs()).toEqual([
      { name: "A", unicodes: [65], componentBaseGlyphNames: [] },
    ]);
  });

  it("saves the active edit snapshot without ending the session", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "shift-bridge-save-"));
    try {
      bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
      const contourId = bridge.addContour().changed.contourIds[0];
      bridge.addPoint(contourId, 10, 20, "onCurve", false);

      const outputPath = join(tempDir, "output.ufo");
      const savedVersion = await bridge.saveFont(outputPath);

      expect(savedVersion).toBe(2);
      expect(bridge.hasEditSession()).toBe(true);
      expect(bridge.getPersistedVersion()).toBe(2);
      expect(bridge.isDirty()).toBe(false);
      expect(existsSync(outputPath)).toBe(true);

      const reloaded = new Bridge();
      reloaded.loadFont(outputPath);
      expect(reloaded.getGlyphs()).toEqual([
        { name: "A", unicodes: [65], componentBaseGlyphNames: [] },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("records the persisted version when an async save completes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "shift-bridge-async-save-"));
    try {
      bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
      bridge.addContour();

      const outputPath = join(tempDir, "async-output.ufo");
      const savedVersion = await bridge.saveFont(outputPath);

      expect(savedVersion).toBe(1);
      expect(bridge.getPersistedVersion()).toBe(1);
      expect(bridge.isDirty()).toBe(false);
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects starting a second active edit session", () => {
    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());

    expect(() => bridge.startEditSession({ name: "B", unicode: 66 }, defaultSourceId())).toThrow(
      /edit session already active/i,
    );
    expect(bridge.getEditingGlyphName()).toBe("A");
  });

  it("adds a point to a contour and returns structure, values, and changed ids", () => {
    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
    const contourChange = bridge.addContour();
    const contourId = contourChange.changed.contourIds[0];

    const change = bridge.addPoint(contourId, 10, 20, "onCurve", false);

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

  it("sets point positions through the bulk typed-array hot path", () => {
    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
    const contourId = bridge.addContour().changed.contourIds[0];
    const pointId = bridge.addPoint(contourId, 10, 20, "onCurve", false).changed.pointIds[0];

    const change = bridge.setPositions(
      new BigUint64Array([BigInt(pointId)]),
      new Float64Array([30, 40]),
      null,
      null,
    );

    expect(change.changed.pointIds).toEqual([pointId]);
    expect(Array.from(change.values)).toEqual([500, 30, 40]);
  });

  it("restores structure and values into the active session", () => {
    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
    const contourId = bridge.addContour().changed.contourIds[0];
    const before = bridge.addPoint(contourId, 10, 20, "onCurve", false);
    const pointId = before.changed.pointIds[0];

    const change = bridge.restoreState(before.structure, new Float64Array([700, 90, 120]));

    expect(change.structure.contours[0].points[0].id).toBe(pointId);
    expect(Array.from(change.values)).toEqual([700, 90, 120]);
  });

  it("surfaces typed bridge errors at the NAPI boundary", () => {
    expect(() => bridge.addContour()).toThrow(/active edit/i);

    bridge.startEditSession({ name: "A", unicode: 65 }, defaultSourceId());
    expect(() => bridge.addPoint("not-a-contour", 10, 20, "onCurve", false)).toThrow(/contour ID/i);
    expect(() =>
      bridge.setPositions(new BigUint64Array([1n]), new Float64Array([10]), null, null),
    ).toThrow(/point positions/i);
  });
});
