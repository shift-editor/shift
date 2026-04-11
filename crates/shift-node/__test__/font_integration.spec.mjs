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

function startEditSessionByUnicode(engine, unicode) {
  const glyphName =
    engine.getGlyphNameForUnicode(unicode) ??
    `uni${unicode.toString(16).toUpperCase().padStart(4, "0")}`;
  engine.startEditSession({ glyphName, unicode });
}

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

    const metadata = JSON.parse(engine.getMetadata());
    expect(metadata.familyName).toBe("MutatorMathTest");
    expect(metadata.styleName).toBe("LightCondensed");
  });

  it("returns correct metrics from MutatorSans UFO", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    const metrics = JSON.parse(engine.getMetrics());
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.ascender).toBe(700);
    expect(metrics.descender).toBe(-200);
    expect(metrics.capHeight).toBe(700);
    expect(metrics.xHeight).toBe(500);
  });

  it("returns glyph unicodes from loaded font", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    const unicodes = engine.getGlyphUnicodes();
    expect(Array.isArray(unicodes)).toBe(true);
    expect(unicodes.length).toBeGreaterThan(0);
    expect(unicodes).toContain(65);
    expect(unicodes).toContain(66);
  });

  it("returns SVG path for glyph by unicode", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    const pathA = engine.getGlyphSvgPath(65);
    expect(pathA).toBeTruthy();
    expect(typeof pathA).toBe("string");
    expect(pathA.length).toBeGreaterThan(0);
    expect(pathA).toMatch(/^M\s/);

    const pathMissing = engine.getGlyphSvgPath(0xffff);
    expect(pathMissing).toBeNull();
  });
});

describe("FontEngine Integration - Edit Session", () => {
  it("starts edit session and gets snapshot with real contour data", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    startEditSessionByUnicode(engine, 65);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = JSON.parse(engine.getSnapshotData());
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

    startEditSessionByUnicode(engine, 65);
    const snapshot = JSON.parse(engine.getSnapshotData());

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
    const originalMetrics = JSON.parse(engine.getMetrics());

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);
    const reloadedMetrics = JSON.parse(engine2.getMetrics());

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

    startEditSessionByUnicode(engine, 65);
    const originalSnapshot = JSON.parse(engine.getSnapshotData());
    engine.endEditSession();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    startEditSessionByUnicode(engine2, 65);
    const reloadedSnapshot = JSON.parse(engine2.getSnapshotData());
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

    startEditSessionByUnicode(engine, 65);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = JSON.parse(engine.getSnapshotData());
    expect(snapshot.unicode).toBe(65);

    engine.endEditSession();
  });

  it("TTF glyph A has contour data", () => {
    if (!existsSync(MUTATORSANS_TTF)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_TTF);

    startEditSessionByUnicode(engine, 65);
    const snapshot = JSON.parse(engine.getSnapshotData());

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

    startEditSessionByUnicode(engine, 193);
    expect(engine.hasEditSession()).toBe(true);

    const snapshot = JSON.parse(engine.getSnapshotData());
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

    startEditSessionByUnicode(engine, 79);
    const originalSnapshot = JSON.parse(engine.getSnapshotData());
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

    startEditSessionByUnicode(engine, 79);
    const snapshot = JSON.parse(engine.getSnapshotData());
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

    startEditSessionByUnicode(engine, 65);
    const originalSnapshot = JSON.parse(engine.getSnapshotData());
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
    const originalMetadata = JSON.parse(engine.getMetadata());

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);
    const reloadedMetadata = JSON.parse(engine2.getMetadata());

    expect(reloadedMetadata.familyName).toBe(originalMetadata.familyName);
    expect(reloadedMetadata.styleName).toBe(originalMetadata.styleName);
  });

  it("preserves point coordinates with precision after round-trip", () => {
    if (!existsSync(MUTATORSANS_UFO)) {
      return;
    }

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    startEditSessionByUnicode(engine, 65);
    const originalSnapshot = JSON.parse(engine.getSnapshotData());
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

    startEditSessionByUnicode(engine2, 65);
    const reloadedSnapshot = JSON.parse(engine2.getSnapshotData());
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

    const sortContoursByFirstPoint = (contours) => {
      return [...contours].sort((a, b) => {
        const ax = a.points[0]?.x ?? 0;
        const ay = a.points[0]?.y ?? 0;
        const bx = b.points[0]?.x ?? 0;
        const by = b.points[0]?.y ?? 0;
        if (Math.abs(ax - bx) > 0.001) return ax - bx;
        return ay - by;
      });
    };

    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);

    startEditSessionByUnicode(engine, 79);
    const originalSnapshot = JSON.parse(engine.getSnapshotData());
    const originalTypes = [];
    for (const contour of sortContoursByFirstPoint(originalSnapshot.contours)) {
      for (const point of contour.points) {
        originalTypes.push(point.pointType);
      }
    }
    engine.endEditSession();

    const outputPath = join(tempDir, "output.ufo");
    engine.saveFont(outputPath);

    const engine2 = new FontEngine();
    engine2.loadFont(outputPath);

    startEditSessionByUnicode(engine2, 79);
    const reloadedSnapshot = JSON.parse(engine2.getSnapshotData());
    const reloadedTypes = [];
    for (const contour of sortContoursByFirstPoint(reloadedSnapshot.contours)) {
      for (const point of contour.points) {
        reloadedTypes.push(point.pointType);
      }
    }
    engine2.endEditSession();

    expect(reloadedTypes).toEqual(originalTypes);
  });
});

// --- Variable font (.glyphs with multiple masters) tests ---

const MUTATORSANS_VARIABLE = join(FIXTURES_PATH, "fonts/MutatorSansVariable.glyphs");

describe("FontEngine Integration - Variable Font (.glyphs)", () => {
  it("detects variable font", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_VARIABLE);
    expect(engine.isVariable()).toBe(true);
  });

  it("returns axes", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_VARIABLE);
    const axes = JSON.parse(engine.getAxes());
    expect(axes).toHaveLength(1);
    expect(axes[0].tag).toBe("wght");
    expect(axes[0].name).toBe("Weight");
    expect(axes[0].minimum).toBe(100);
    expect(axes[0].maximum).toBe(900);
    expect(axes[0].default).toBe(100);
  });

  it("returns sources", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_VARIABLE);
    const sources = JSON.parse(engine.getSources());
    expect(sources).toHaveLength(2);
    expect(sources[0].location.values.wght).toBe(100);
    expect(sources[1].location.values.wght).toBe(900);
  });

  it("returns master snapshots for glyph A", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_VARIABLE);
    const json = engine.getGlyphMasterSnapshots("A");
    expect(json).not.toBeNull();
    const masters = JSON.parse(json);
    expect(masters).toHaveLength(2);

    // Each master snapshot has sourceId, sourceName, location, snapshot
    for (const m of masters) {
      expect(m).toHaveProperty("sourceId");
      expect(m).toHaveProperty("sourceName");
      expect(m).toHaveProperty("location");
      expect(m).toHaveProperty("snapshot");
      expect(m.snapshot.contours).toHaveLength(2);
    }

    // Both masters should have matching total point counts
    const lightTotal = masters[0].snapshot.contours.reduce((s, c) => s + c.points.length, 0);
    const boldTotal = masters[1].snapshot.contours.reduce((s, c) => s + c.points.length, 0);
    expect(lightTotal).toBe(boldTotal);
  });

  it("non-variable font returns isVariable false", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_UFO);
    expect(engine.isVariable()).toBe(false);
  });

  it("returns null for non-existent glyph master snapshots", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_VARIABLE);
    const json = engine.getGlyphMasterSnapshots("nonexistent");
    expect(json).toBeNull();
  });
});

// --- Designspace (.designspace) tests ---

const MUTATORSANS_DESIGNSPACE = join(
  FIXTURES_PATH,
  "fonts/mutatorsans-variable/MutatorSans.designspace",
);

describe("FontEngine Integration - Designspace", () => {
  it("loads designspace and detects variable font", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    expect(engine.isVariable()).toBe(true);
    expect(engine.getGlyphCount()).toBeGreaterThan(10);
  });

  it("returns axes from designspace", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    const axes = JSON.parse(engine.getAxes());
    expect(axes).toHaveLength(2);
    expect(axes[0].tag).toBe("wdth");
    expect(axes[0].minimum).toBe(0);
    expect(axes[0].maximum).toBe(1000);
    expect(axes[1].tag).toBe("wght");
  });

  it("returns sources from designspace", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    const sources = JSON.parse(engine.getSources());
    // 4 main masters + 3 support layers
    expect(sources).toHaveLength(7);
    expect(sources[0].location.values.wdth).toBe(0);
    expect(sources[0].location.values.wght).toBe(0);
  });

  it("returns master snapshots for glyph A", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    const json = engine.getGlyphMasterSnapshots("A");
    expect(json).not.toBeNull();
    const masters = JSON.parse(json);
    expect(masters.length).toBeGreaterThanOrEqual(4);
    for (const m of masters) {
      expect(m.snapshot.contours.length).toBeGreaterThan(0);
    }
  });

  it("excludes empty contours from master snapshots", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    const json = engine.getGlyphMasterSnapshots("A");
    const masters = JSON.parse(json);
    for (const m of masters) {
      for (const contour of m.snapshot.contours) {
        expect(contour.points.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns consistent contour order across masters", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    const json = engine.getGlyphMasterSnapshots("A");
    const masters = JSON.parse(json);

    // All masters should have the same contour signature (point counts per contour)
    const sigs = masters.map(m =>
      m.snapshot.contours.map(c => c.points.length).join(",")
    );
    const uniqueSigs = new Set(sigs);
    expect(uniqueSigs.size).toBe(1);
  });

  it("returns master snapshots for the currently editing glyph", () => {
    const engine = new FontEngine();
    engine.loadFont(MUTATORSANS_DESIGNSPACE);
    engine.startEditSession({ glyphName: "A", unicode: 65 });

    // Glyph is taken from font during session, but snapshots should still work
    const json = engine.getGlyphMasterSnapshots("A");
    expect(json).not.toBeNull();
    const masters = JSON.parse(json);
    expect(masters.length).toBeGreaterThanOrEqual(4);

    engine.endEditSession();
  });
});
