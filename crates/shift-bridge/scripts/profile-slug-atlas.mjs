import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const sourceArgument = process.argv[2];
if (!sourceArgument) {
  throw new Error("usage: node scripts/profile-slug-atlas.mjs <font-or-package> [iterations]");
}

const iterations = Number.parseInt(process.argv[3] ?? "10", 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error(`invalid iteration count: ${process.argv[3]}`);
}

const sourcePath = isAbsolute(sourceArgument) ? sourceArgument : resolve(sourceArgument);
const tempDirectory = mkdtempSync(join(tmpdir(), "shift-slug-profile-"));
const storePath = join(tempDirectory, "working.sqlite");
const packagePath = join(tempDirectory, "profile.shift");
const bridge = new Bridge();

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - started };
}

function prepare() {
  const { value: atlas, milliseconds } = measure(() => bridge.prepareSlugAtlas(256));
  const signature = {
    rootGlyphs: atlas.glyphs.length,
    atlasGlyphs: atlas.atlasGlyphCount,
    curves: atlas.curveCount,
    components: atlas.componentCount,
    bytes: atlas.layout.totalLength,
  };
  bridge.discardSlugAtlas(atlas.generation);
  return { milliseconds, signature };
}

function percentile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

try {
  const opened = measure(() => bridge.openWorkspace(sourcePath, storePath));
  const cold = prepare();
  bridge.saveWorkspaceAs(packagePath);

  bridge.closeWorkspace();
  const resumed = measure(() => bridge.resumeWorkspaceForSource(storePath, packagePath));
  const resumedAuthoredCompilation = measure(() => bridge.prepareAuthoredGlyphCompilation());
  const resumedAlignedPrepare = prepare();

  const warm = Array.from({ length: iterations }, prepare);
  for (const sample of [resumedAlignedPrepare, ...warm]) {
    if (JSON.stringify(sample.signature) !== JSON.stringify(cold.signature)) {
      throw new Error("Slug atlas counts changed between preparations");
    }
  }

  const samples = warm.map((sample) => sample.milliseconds).sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        sourcePath,
        iterations,
        openMs: opened.milliseconds,
        coldPrepareMs: cold.milliseconds,
        resumeMs: resumed.milliseconds,
        resumedAuthoredCompilationMs: resumedAuthoredCompilation.milliseconds,
        resumedAlignedPrepareMs: resumedAlignedPrepare.milliseconds,
        resumedPreviewMs:
          resumedAuthoredCompilation.milliseconds + resumedAlignedPrepare.milliseconds,
        warmPrepareMs: {
          p50: percentile(samples, 0.5),
          p95: percentile(samples, 0.95),
          samples,
        },
        signature: cold.signature,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    bridge.closeWorkspace();
  } catch {
    // The workspace may not have opened.
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}
