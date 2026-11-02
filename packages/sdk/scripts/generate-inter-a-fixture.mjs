import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INTER_COMMIT = "353b61b9f4430d5f420d56605a6e7993e0941470";
const INTER_REPOSITORY = "https://github.com/rsms/inter.git";
const SOURCE_PATH = "src/Inter-Roman.glyphspackage";
const TEXT_INSTANCES = "Thin,ExtraLight,Light,Regular,Medium,SemiBold,Bold,ExtraBold,Black";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = argument("--output");
if (!output) throw new Error("Usage: pnpm generate:inter-a-fixture -- --output <fixture.json>");

const root = await mkdtemp(join(tmpdir(), "shift-inter-a-"));
const checkout = join(root, "inter");
const packed = join(root, "inter-a.font");

try {
  execFileSync(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", INTER_REPOSITORY, checkout],
    { stdio: "inherit" },
  );
  execFileSync("git", ["-C", checkout, "sparse-checkout", "set", SOURCE_PATH], {
    stdio: "inherit",
  });
  execFileSync("git", ["-C", checkout, "checkout", INTER_COMMIT], { stdio: "inherit" });

  // Inter's lowercase `a` and every master, packed as a memory session opens a font.
  execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--release",
      "--package",
      "shift-cli",
      "--",
      "font",
      "pack",
      join(checkout, SOURCE_PATH),
      "--glyph",
      "a",
      "--output",
      packed,
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const font = await readFile(packed);
  await validate(font);

  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ font: font.toString("base64") }, null, 2)}\n`);

  const sourceLicense = await readFile(join(checkout, "LICENSE.txt"), "utf8");
  if (!sourceLicense.includes("SIL OPEN FONT LICENSE Version 1.1")) {
    throw new Error("Inter source license is not SIL Open Font License 1.1");
  }
  await writeFile(join(dirname(target), "Inter-LICENSE.txt"), sourceLicense);

  console.log(`Generated Inter a fixture (${font.byteLength} bytes) at ${target}`);
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Opens the packed font as a memory session's engine does, and checks what the fixture must hold. */
async function validate(font) {
  const { loadEngine } = await import(
    pathToFileURL(resolve(repositoryRoot, "packages/editor/src/lib/wasm/engine.ts")).href
  );
  const { EngineSession } = await loadEngine();
  const engine = EngineSession.openResident(new Uint8Array(font));
  try {
    const { axes, sources, glyphs } = engine.fontRecords();
    const { metadata, namedInstances } = engine.fontHeader();
    if (metadata.familyName !== "Inter") throw new Error("Unexpected font family");
    if (axes.map((axis) => axis.tag).join(",") !== "opsz,wght") {
      throw new Error("Inter fixture must preserve optical-size and weight axes");
    }
    if (sources.length !== 6) throw new Error("Inter fixture must preserve six authored masters");
    if (glyphs.map((record) => record.name).join(",") !== "a") {
      throw new Error("Inter fixture must hold lowercase a alone");
    }
    const names = new Set(namedInstances.map((instance) => instance.name));
    if (!TEXT_INSTANCES.split(",").every((name) => names.has(name))) {
      throw new Error("Inter fixture must preserve the nine text instances");
    }

    const [glyph] = engine.glyphSnapshots([glyphs[0].id]);
    if (!glyph?.projection?.interpolation) {
      throw new Error("Inter fixture is missing source interpolation");
    }
    if (glyph.layers.length !== 6) throw new Error("Inter a must have a layer in every master");
    for (const layer of glyph.layers) {
      const contours = layer.state.structure.contours;
      if (contours.reduce((count, contour) => count + contour.points.length, 0) !== 43) {
        throw new Error("Inter fixture must preserve 43 authored cubic points per master");
      }
      for (const contour of contours) validateCubicContour(contour.points);
    }
  } finally {
    engine.dispose();
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
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
