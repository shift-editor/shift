import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const shortIdAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const shortIdLength = 10;
const shortIdAlphabetMask = shortIdAlphabet.length - 1;
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

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
    const record = applied.next.glyphChanges.updated.find((glyph) => glyph.id === glyphId);
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

  it("rejects an intent kind it does not know", () => {
    expect(() => bridge.apply([{ kind: "explodeFont", explodeFont: {} }])).toThrow();
  });

  it("exposes the durable Slug cache revision", () => {
    expect(bridge.slugAtlasCacheRevision()).toBe("0");

    createGlyphLayer();

    expect(bridge.slugAtlasCacheRevision()).toBe("1");
  });

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

  function openMutatorWorkspace() {
    const sourcePath = join(repositoryRoot, "fixtures/fonts/mutatorsans/MutatorSans.ttf");
    const storePath = join(tempDir, "mutatorsans.sqlite");
    bridge.openWorkspace(sourcePath, storePath);
  }

  it("transports imported variation without fabricating authored sources", () => {
    bridge.closeWorkspace();
    const sourcePath = join(
      repositoryRoot,
      "fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
    );
    const font = bridge.openFontSource(sourcePath);
    const glyph = font.glyphs.find((entry) => entry.name === "A");
    if (!glyph) throw new Error("MutatorSans fixture has no A glyph");

    const projection = bridge.readFontSourceGlyph(glyph.id)[0]?.projection;

    expect(projection?.interpolation).toBeUndefined();
    expect(projection?.variation?.basis.deltas.length).toBeGreaterThan(0);
  });

  it("acquires every lazy glyph payload before preparing the complete Slug atlas", () => {
    openMutatorWorkspace();

    const atlas = bridge.prepareSlugAtlas(256);
    expect(atlas.glyphs).toHaveLength(bridge.getGlyphs().length);
    expect(atlas.curveCount).toBeGreaterThan(0);
    expect(atlas.layout.totalLength).toBeGreaterThan(0);
  });

  it("acquires lazy glyph payloads before preparing a Slug atlas patch", () => {
    openMutatorWorkspace();

    const glyph = bridge.getGlyphs().find((record) => record.name === "S");
    expect(glyph).toBeDefined();

    const atlas = bridge.prepareSlugAtlasPage([glyph.id], 256);
    expect(atlas.glyphs).toContainEqual(expect.objectContaining({ glyphId: glyph.id }));
    expect(atlas.curveCount).toBeGreaterThan(0);
    expect(atlas.layout.totalLength).toBeGreaterThan(0);
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

/**
 * Opens a font source and replaces every minted id with a readable label, so a
 * test can compare the whole preview snapshot.
 */
function openPreview(relativePath) {
  const snapshot = new Bridge().openFontSource(join(repositoryRoot, relativePath));
  const labels = new Map([
    ...snapshot.axes.map(({ id, tag }) => [id, `axis:${tag}`]),
    ...snapshot.metricDefinitions.map(({ id, kind }) => [id, `metric:${kind}`]),
    ...snapshot.sources.map(({ id, name }) => [id, `source:${name}`]),
    ...snapshot.namedInstances.map(({ id, name }) => [id, `instance:${name}`]),
    ...snapshot.glyphs.map(({ id, name }) => [id, `glyph:${name}`]),
  ]);
  const label = (value) => labels.get(value) ?? value;

  return JSON.parse(JSON.stringify(snapshot), (key, value) => {
    if (typeof value === "string") return label(value);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [label(field), entry]));
  });
}

/** One row per source: name, file, location and standard metric positions. */
function sourceRows(snapshot) {
  return snapshot.sources.map((source) => [
    source.name,
    source.filename,
    source.location.values,
    source.metricValues.map(({ position }) => position),
  ]);
}

const standardMetricDefinitions = [
  { id: "metric:ascender", kind: "ascender", name: "Ascender" },
  { id: "metric:capHeight", kind: "capHeight", name: "Cap Height" },
  { id: "metric:xHeight", kind: "xHeight", name: "x-Height" },
  { id: "metric:baseline", kind: "baseline", name: "Baseline" },
  { id: "metric:descender", kind: "descender", name: "Descender" },
];

/** Standard metric values at the given positions, without overshoot. */
function metricValues(positions) {
  return standardMetricDefinitions.map(({ id }, index) => ({
    metricId: id,
    position: positions[index],
    overshoot: 0,
  }));
}

describe("font source previews", () => {
  it("describes a Designspace from its directory", () => {
    const snapshot = openPreview("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    const axis = (tag, name) => ({
      id: `axis:${tag}`,
      tag,
      name,
      minimum: 0,
      default: 0,
      maximum: 1000,
      hidden: false,
      axisType: "continuous",
      role: "external",
      labels: [],
    });
    const location = (wght, wdth) => ({ "axis:wght": wght, "axis:wdth": wdth });
    const instance = (name, wght, wdth, postscriptName) => ({
      id: `instance:${name}`,
      name,
      location: { values: location(wght, wdth) },
      ...(postscriptName && { postscriptName }),
    });
    const lightMetrics = [700, 700, 500, 0, -200];
    const boldMetrics = [800, 800, 500, 0, -200];
    const lightCondensed = "MutatorSansLightCondensed.ufo";

    expect(Object.keys(snapshot).sort()).toEqual([
      "axes",
      "axisMappingBases",
      "axisMappings",
      "glyphs",
      "kerning",
      "metadata",
      "metricDefinitions",
      "metrics",
      "namedInstances",
      "sources",
    ]);
    expect(snapshot.metadata).toEqual({
      familyName: "MutatorMathTest",
      styleName: "LightCondensed",
    });
    expect(snapshot.metrics).toEqual({ unitsPerEm: 1000 });
    expect(snapshot.metricDefinitions).toEqual(standardMetricDefinitions);
    expect(snapshot.axes).toEqual([axis("wdth", "width"), axis("wght", "weight")]);
    expect(snapshot.axisMappings).toEqual([]);
    expect(snapshot.axisMappingBases).toEqual([]);
    expect(snapshot.kerning).toEqual({ groups: [], sources: [] });

    expect(snapshot.sources[0]).toEqual({
      id: "source:LightCondensed",
      name: "LightCondensed",
      location: { values: location(0, 0) },
      filename: lightCondensed,
      metricValues: metricValues(lightMetrics),
      italicAngle: 0,
      lineGap: 0,
    });
    expect(sourceRows(snapshot)).toEqual([
      ["LightCondensed", lightCondensed, location(0, 0), lightMetrics],
      ["BoldCondensed", "MutatorSansBoldCondensed.ufo", location(1000, 0), boldMetrics],
      ["LightWide", "MutatorSansLightWide.ufo", location(0, 1000), lightMetrics],
      ["BoldWide", "MutatorSansBoldWide.ufo", location(1000, 1000), boldMetrics],
      ["MutatorSansLightCondensed", lightCondensed, location(700, 0), lightMetrics],
      ["Source 5", lightCondensed, location(700, 1000), lightMetrics],
      ["Source 6", lightCondensed, location(700, 569.0780029296875), lightMetrics],
    ]);
    for (const source of snapshot.sources) {
      expect(source).toMatchObject({ italicAngle: 0, lineGap: 0 });
      expect(source.metricValues.map(({ overshoot }) => overshoot)).toEqual([0, 0, 0, 0, 0]);
    }

    expect(snapshot.namedInstances).toEqual([
      instance("LightCondensed", 0, 0, "MutatorMathTest-LightCondensed"),
      instance("BoldCondensed", 1000, 0, "MutatorMathTest-BoldCondensed"),
      instance("LightWide", 0, 1000, "MutatorMathTest-LightWide"),
      instance("BoldWide", 1000, 1000, "MutatorMathTest-BoldWide"),
      instance("Medium_Narrow_I", 500, 327, "MutatorMathTest-Medium_Narrow_I"),
      instance("Two", 1000, 569.0780029296875, "MutatorMathTest-Two"),
      instance("One", 500, 1000, "MutatorMathTest-One"),
      instance("UserLocation_700", 775.6090087890625, 700, "MutatorSans-UserLocation_700"),
      instance("UserLocation_100", 658.5969848632812, 100),
      instance("Medium_Wide_I", 500, 328),
      instance("Anisotropic_one", 200, 500),
      instance("Support_Layer_Demo", 700, 569.0780029296875),
      instance("Rule_result_1", 140, 140),
      instance("Rule_result_2", 700, 700),
    ]);

    expect(snapshot.glyphs).toHaveLength(49);
    expect(snapshot.glyphs.slice(0, 3)).toEqual([
      { id: "glyph:.notdef", name: ".notdef", unicodes: [] },
      { id: "glyph:A", name: "A", unicodes: [65] },
      { id: "glyph:Aacute", name: "Aacute", unicodes: [193] },
    ]);
    for (const glyph of snapshot.glyphs) {
      expect(glyph.id).toBe(`glyph:${glyph.name}`);
    }
  });

  it("describes a compiled font as one source without a location", () => {
    const snapshot = openPreview("fixtures/fonts/mutatorsans/MutatorSans.ttf");

    expect(snapshot.metadata).toEqual({ styleName: "Regular" });
    expect(snapshot.metrics).toEqual({ unitsPerEm: 1000 });
    expect(snapshot.metricDefinitions).toEqual(standardMetricDefinitions);
    expect(snapshot.sources).toEqual([
      {
        id: "source:Regular",
        name: "Regular",
        location: { values: {} },
        metricValues: metricValues([1000, 700, 500, 0, -200]),
        lineGap: 0,
      },
    ]);
    expect(snapshot.axes).toEqual([]);
    expect(snapshot.namedInstances).toEqual([]);
    expect(snapshot.glyphs).toHaveLength(49);
  });
});
