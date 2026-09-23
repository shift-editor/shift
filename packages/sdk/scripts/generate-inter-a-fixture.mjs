import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INTER_COMMIT = "353b61b9f4430d5f420d56605a6e7993e0941470";
const INTER_REPOSITORY = "https://github.com/rsms/inter.git";
const EXPECTED_SHA256 = "48fadb16bf93ced1bc1630f2b282df3ea2c0777d5d40b141377a51bf429bf287";
const SOURCE_PATH = "src/Inter-Roman.glyphspackage";
const ID_PREFIXES = new Set([
  "anchor",
  "axis",
  "axisLabel",
  "axisMapping",
  "component",
  "contour",
  "glyph",
  "guideline",
  "layer",
  "metric",
  "namedInstance",
  "point",
  "source",
]);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = argument("--output");
if (!output) throw new Error("Usage: pnpm generate:inter-a-fixture -- --output <fixture.json>");

const root = await mkdtemp(join(tmpdir(), "shift-inter-a-"));
const checkout = join(root, "inter");
const workspace = join(root, "workspace.sqlite3");

try {
  execFileSync(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", INTER_REPOSITORY, checkout],
    {
      stdio: "inherit",
    },
  );
  execFileSync("git", ["-C", checkout, "sparse-checkout", "set", SOURCE_PATH], {
    stdio: "inherit",
  });
  execFileSync("git", ["-C", checkout, "checkout", INTER_COMMIT], { stdio: "inherit" });

  const bridgeModule = await import(
    pathToFileURL(resolve(repositoryRoot, "crates/shift-bridge/index.js")).href
  );
  const bridge = new bridgeModule.Bridge();

  try {
    bridge.openWorkspace(join(checkout, SOURCE_PATH), workspace);
    const record = bridge.getGlyphs().find((candidate) => candidate.name === "a");
    if (!record || !record.unicodes.includes(0x61)) throw new Error("Inter lowercase a not found");

    const glyphs = bridge.getGlyphSnapshots([{ glyphId: record.id }]);
    const glyph = glyphs[0];
    if (!glyph) throw new Error("Inter lowercase a snapshot is missing");

    const axes = bridge.getAxes();
    const opticalSizeAxis = axes.find((axis) => axis.tag === "opsz");
    const namedInstances = bridge
      .getNamedInstances()
      .filter(
        (instance) =>
          !opticalSizeAxis ||
          instance.location.values[opticalSizeAxis.id] === opticalSizeAxis.default,
      );
    const font = {
      metadata: bridge.getMetadata(),
      metrics: bridge.getMetrics(),
      metricDefinitions: bridge.getMetricDefinitions(),
      sourceMetricsInterpolation: bridge.getSourceMetricsInterpolation(),
      glyphs: [record],
      sources: bridge.getSources(),
      axes,
      axisMappings: bridge.getAxisMappings(),
      axisMappingBases: bridge.getAxisMappingBases(),
      namedInstances,
    };

    validate({ font, record, glyph });

    const fixture = { font, records: [record], glyphs };
    normalizeCollections(fixture);
    const canonicalFixture = canonicalizeIds(fixture);
    const json = JSON.stringify(
      canonicalFixture,
      (_key, value) => (value instanceof Float64Array ? { $float64: Array.from(value) } : value),
      2,
    );
    if (/\/(?:home|Users|tmp)\//.test(json)) {
      throw new Error("Generated fixture contains a machine-local path");
    }
    const digest = createHash("sha256").update(`${json}\n`).digest("hex");
    if (digest !== EXPECTED_SHA256) {
      throw new Error(`Generated fixture changed: expected ${EXPECTED_SHA256}, received ${digest}`);
    }

    const target = resolve(output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${json}\n`);

    const sourceLicense = await readFile(join(checkout, "LICENSE.txt"), "utf8");
    if (!sourceLicense.includes("SIL OPEN FONT LICENSE Version 1.1")) {
      throw new Error("Inter source license is not SIL Open Font License 1.1");
    }

    console.log(
      `Generated Inter a fixture with ${record.layers.length} masters and ${namedInstances.length} instances at ${target}`,
    );
  } finally {
    bridge.closeWorkspace();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function normalizeCollections(fixture) {
  const sourceOrder = new Map(fixture.font.sources.map((source, index) => [source.id, index]));
  const metricOrder = new Map(
    fixture.font.metricDefinitions.map((metric, index) => [metric.id, index]),
  );
  const bySourceOrder = (left, right) =>
    (sourceOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
    (sourceOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER);

  for (const source of fixture.font.sources) {
    source.metricValues.sort(
      (left, right) =>
        (metricOrder.get(left.metricId) ?? Number.MAX_SAFE_INTEGER) -
        (metricOrder.get(right.metricId) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  for (const record of fixture.records) record.layers.sort(bySourceOrder);
  for (const glyph of fixture.glyphs) glyph.layers.sort(bySourceOrder);
}

function canonicalizeIds(value) {
  const ids = new Map();
  const counts = new Map();
  const register = (id) => {
    if (typeof id !== "string" || ids.has(id)) return;
    const match = /^([A-Za-z]+)_/.exec(id);
    const prefix = match?.[1];
    if (!prefix || !ID_PREFIXES.has(prefix)) return;

    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    ids.set(id, `${prefix}_fixture_${String(next).padStart(3, "0")}`);
  };

  for (const axis of value.font.axes) {
    register(axis.id);
    for (const label of axis.labels) register(label.id);
  }
  for (const metric of value.font.metricDefinitions) register(metric.id);
  for (const source of value.font.sources) register(source.id);
  for (const mapping of value.font.axisMappings) register(mapping.id);
  for (const instance of value.font.namedInstances) register(instance.id);
  for (const record of value.records) {
    register(record.id);
    for (const layer of record.layers) register(layer.id);
  }
  for (const glyph of value.glyphs) {
    register(glyph.glyphId);
    for (const layer of glyph.layers) {
      register(layer.state.layerId);
      for (const contour of layer.state.structure.contours) {
        register(contour.id);
        for (const point of contour.points) register(point.id);
      }
      for (const anchor of layer.state.structure.anchors) register(anchor.id);
      for (const component of layer.state.structure.components) register(component.id);
      for (const guideline of layer.state.structure.guidelines ?? []) register(guideline.id);
    }
  }

  function visit(item) {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      if (item instanceof Float64Array) return item;
      return Object.fromEntries(
        Object.entries(item)
          .map(([key, nested]) => [ids.get(key) ?? key, visit(nested)])
          .sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    if (typeof item !== "string") return item;

    const match = /^([A-Za-z]+)_/.exec(item);
    const prefix = match?.[1];
    if (!prefix || !ID_PREFIXES.has(prefix)) return item;

    register(item);
    return ids.get(item);
  }

  return visit(value);
}

function validate({ font, record, glyph }) {
  if (font.metadata.familyName !== "Inter") throw new Error("Unexpected font family");
  if (font.sources.length !== 6 || record.layers.length !== 6 || glyph.layers.length !== 6) {
    throw new Error("Inter fixture must preserve six authored masters");
  }
  if (font.axes.map((axis) => axis.tag).join(",") !== "opsz,wght") {
    throw new Error("Inter fixture must preserve optical-size and weight axes");
  }
  if (!glyph.projection?.interpolation) {
    throw new Error("Inter fixture is missing source interpolation");
  }
  if (
    font.namedInstances.map((instance) => instance.name).join(",") !==
    "Thin,ExtraLight,Light,Regular,Medium,SemiBold,Bold,ExtraBold,Black"
  ) {
    throw new Error("Inter fixture must preserve the nine text optical-size instances");
  }

  for (const layer of glyph.layers) {
    const contours = layer.state.structure.contours;
    if (contours.reduce((count, contour) => count + contour.points.length, 0) !== 43) {
      throw new Error("Inter fixture must preserve 43 authored cubic points per master");
    }
    for (const contour of contours) validateCubicContour(contour.points);
  }
}

function validateCubicContour(points) {
  let onCurveIndex = points.findIndex((point) => point.pointType === "onCurve");
  if (onCurveIndex === -1)
    throw new Error("Inter fixture contains a contour without on-curve points");

  let offCurves = 0;
  for (let offset = 1; offset <= points.length; offset += 1) {
    const point = points[(onCurveIndex + offset) % points.length];
    if (point.pointType === "offCurve") {
      offCurves += 1;
      continue;
    }
    if (offCurves !== 0 && offCurves !== 2) {
      throw new Error("Inter fixture contains a non-cubic curve segment");
    }
    offCurves = 0;
  }
}
