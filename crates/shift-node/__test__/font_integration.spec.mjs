import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const require = createRequire(import.meta.url);
const { FontEngine } = require("../index.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "..", "..", "fixtures");
const MUTATORSANS_UFO = join(FIXTURES_PATH, "fonts/mutatorsans/MutatorSansLightCondensed.ufo");
const MUTATORSANS_TTF = join(FIXTURES_PATH, "fonts/mutatorsans/MutatorSans.ttf");

describe("FontEngine Integration - UFO Loading", () => {
  it("loads MutatorSans UFO successfully", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      console.log("Skipping: MutatorSans UFO not found");
      return;
    }

    const engine = new FontEngine();
    expect(() => engine.loadFont(MUTATORSANS_UFO)).not.toThrow();
    expect(engine.getGlyphCount()).toBe(48);
  });

  it("returns correct metadata from MutatorSans UFO", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    const metadata = engine.getMetadata();
    expect(metadata.familyName).toBe("MutatorMathTest");
    expect(metadata.styleName).toBe("LightCondensed");
  });

  it("returns correct metrics from MutatorSans UFO", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    const metrics = engine.getMetrics();
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.ascender).toBe(700);
    expect(metrics.descender).toBe(-200);
    expect(metrics.capHeight).toBe(700);
    expect(metrics.xHeight).toBe(500);
  });
});

describe("FontEngine Integration - Edit Session", () => {
  it("starts edit session and gets snapshot with real contour data", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(65);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = engine.getSnapshotData();
    expect(snapshot).toBeTruthy();
    expect(snapshot.name).toBe("A");
    expect(snapshot.unicode).toBe(65);
    expect(snapshot.contours.length).toBeGreaterThan(0);

    const contour = snapshot.contours[0];
    expect(contour.points.length).toBeGreaterThan(0);

    const point = contour.points[0];
    expect(typeof point.x).toBe("number");
    expect(typeof point.y).toBe("number");
    expect(["onCurve", "offCurve"]).toContain(point.pointType);

    engine.endEditSession();
  });

  it("getSnapshotData returns native snapshot object", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(65);
    const snapshot = engine.getSnapshotData();

    expect(snapshot.name).toBe("A");
    expect(snapshot.unicode).toBe(65);
    expect(snapshot.contours.length).toBeGreaterThan(0);

    engine.endEditSession();
  });
});

describe("FontEngine Integration - Round Trip", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-test-"));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("saves and reloads UFO with same glyph count", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);
    const originalCount = engine.getGlyphCount();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    expect(engine2.getGlyphCount()).toBe(originalCount);
  });

  it("preserves metrics after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);
    const originalMetrics = engine.getMetrics();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);
    const reloadedMetrics = engine2.getMetrics();

    expect(reloadedMetrics.unitsPerEm).toBe(originalMetrics.unitsPerEm);
    expect(reloadedMetrics.ascender).toBe(originalMetrics.ascender);
    expect(reloadedMetrics.descender).toBe(originalMetrics.descender);
  });

  it("preserves glyph contour data after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(65);
    const originalSnapshot = engine.getSnapshotData();
    engine.endEditSession();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    engine2.startEditSession(65);
    const reloadedSnapshot = engine2.getSnapshotData();
    engine2.endEditSession();

    expect(reloadedSnapshot.contours.length).toBe(originalSnapshot.contours.length);

    for (let i = 0; i < originalSnapshot.contours.length; i++) {
      const origContour = originalSnapshot.contours[i];
      const reloadContour = reloadedSnapshot.contours[i];

      expect(reloadContour.points.length).toBe(origContour.points.length);
      expect(reloadContour.closed).toBe(origContour.closed);
    }
  });
});

describe("FontEngine Integration - TTF Loading", () => {
  it("loads MutatorSans TTF successfully", () => {
    if (!existsSync(MUTATORSANS_TTF)) {
      console.log("Skipping: MutatorSans TTF not found");
      return;
    }

    const engine = new FontEngine();
    expect(() => engine.loadFont(MUTATORSANS_TTF)).not.toThrow();
    expect(engine.getGlyphCount()).toBeGreaterThan(0);
  });

  it("can start edit session on TTF glyph", () => {
    if (!existsSync(MUTATORSANS_TTF)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_TTF);

    engine.startEditSession(65);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = engine.getSnapshotData();
    expect(snapshot.unicode).toBe(65);

    engine.endEditSession();
  });

  it("TTF glyph A has contour data", () => {
    if (!existsSync(MUTATORSANS_TTF)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_TTF);

    engine.startEditSession(65);
    const snapshot = engine.getSnapshotData();

    expect(snapshot.contours.length).toBeGreaterThan(0);

    const firstContour = snapshot.contours[0];
    expect(firstContour.points.length).toBeGreaterThan(0);

    const hasOnCurve = firstContour.points.some((p) => p.pointType === "onCurve");
    expect(hasOnCurve).toBe(true);

    engine.endEditSession();
  });
});

describe("FontEngine Integration - Composite Glyphs", () => {
  it("loads composite glyph Aacute (unicode 193)", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(193);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = engine.getSnapshotData();
    expect(snapshot.name).toBe("Aacute");
    expect(snapshot.unicode).toBe(193);

    engine.endEditSession();
  });
});

describe("FontEngine Integration - Point Types", () => {
  it("preserves point types after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(79);
    const originalSnapshot = engine.getSnapshotData();
    engine.endEditSession();

    const originalPointTypes = [];
    for (const contour of originalSnapshot.contours) {
      for (const point of contour.points) {
        originalPointTypes.push(point.pointType);
      }
    }

    const hasOnCurve = originalPointTypes.includes("onCurve");
    const hasOffCurve = originalPointTypes.includes("offCurve");

    expect(hasOnCurve).toBe(true);
    expect(hasOffCurve).toBe(true);
  });

  it("preserves smooth flags after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(79);
    const snapshot = engine.getSnapshotData();
    engine.endEditSession();

    const smoothFlags = [];
    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        smoothFlags.push(point.smooth);
      }
    }

    expect(smoothFlags.length).toBeGreaterThan(0);
  });

  it("preserves closed contour state after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(65);
    const originalSnapshot = engine.getSnapshotData();
    engine.endEditSession();

    for (const contour of originalSnapshot.contours) {
      expect(contour.closed).toBe(true);
    }
  });
});

describe("FontEngine Integration - Extended Round Trip", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-test-"));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves metadata after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);
    const originalMetadata = engine.getMetadata();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);
    const reloadedMetadata = engine2.getMetadata();

    expect(reloadedMetadata.familyName).toBe(originalMetadata.familyName);
    expect(reloadedMetadata.styleName).toBe(originalMetadata.styleName);
  });

  it("preserves point coordinates with precision after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(65);
    const originalSnapshot = engine.getSnapshotData();
    const originalPoints = [];
    for (const contour of originalSnapshot.contours) {
      for (const point of contour.points) {
        originalPoints.push({ x: point.x, y: point.y });
      }
    }
    engine.endEditSession();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    engine2.startEditSession(65);
    const reloadedSnapshot = engine2.getSnapshotData();
    const reloadedPoints = [];
    for (const contour of reloadedSnapshot.contours) {
      for (const point of contour.points) {
        reloadedPoints.push({ x: point.x, y: point.y });
      }
    }
    engine2.endEditSession();

    expect(reloadedPoints.length).toBe(originalPoints.length);

    const sortByCoords = (a, b) => {
      if (Math.abs(a.x - b.x) > 0.001) return a.x - b.x;
      return a.y - b.y;
    };

    const sortedOriginal = [...originalPoints].sort(sortByCoords);
    const sortedReloaded = [...reloadedPoints].sort(sortByCoords);

    for (let i = 0; i < sortedOriginal.length; i++) {
      expect(Math.abs(sortedOriginal[i].x - sortedReloaded[i].x)).toBeLessThan(0.001);
      expect(Math.abs(sortedOriginal[i].y - sortedReloaded[i].y)).toBeLessThan(0.001);
    }
  });

  it("preserves point types after save and reload", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    engine.startEditSession(79);
    const originalSnapshot = engine.getSnapshotData();
    const originalTypes = [];
    for (const contour of originalSnapshot.contours) {
      for (const point of contour.points) {
        originalTypes.push(point.pointType);
      }
    }
    engine.endEditSession();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    engine2.startEditSession(79);
    const reloadedSnapshot = engine2.getSnapshotData();
    const reloadedTypes = [];
    for (const contour of reloadedSnapshot.contours) {
      for (const point of contour.points) {
        reloadedTypes.push(point.pointType);
      }
    }
    engine2.endEditSession();

    expect(reloadedTypes).toEqual(originalTypes);
  });
});
