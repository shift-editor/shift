import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const sourceArgument = process.argv[2];
if (!sourceArgument) {
  throw new Error(
    "usage: node scripts/profile-slug-atlas.mjs <font-or-package> [warm-iterations] [resume-iterations]",
  );
}

const warmIterations = Number.parseInt(process.argv[3] ?? "10", 10);
if (!Number.isSafeInteger(warmIterations) || warmIterations < 1) {
  throw new Error(`invalid warm iteration count: ${process.argv[3]}`);
}
const resumeIterations = Number.parseInt(process.argv[4] ?? "5", 10);
if (!Number.isSafeInteger(resumeIterations) || resumeIterations < 1) {
  throw new Error(`invalid resume iteration count: ${process.argv[4]}`);
}

const sourcePath = isAbsolute(sourceArgument) ? sourceArgument : resolve(sourceArgument);
const tempDirectory = mkdtempSync(join(tmpdir(), "shift-slug-profile-"));
const storePath = join(tempDirectory, "working.sqlite");
const packagePath = join(tempDirectory, "profile.shift");
const bridge = new Bridge();
const bridges = [bridge];

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - started };
}

function prepare(targetBridge) {
  const { value: atlas, milliseconds } = measure(() => targetBridge.prepareSlugAtlas(256));
  const signature = {
    rootGlyphs: atlas.glyphs.length,
    atlasGlyphs: atlas.atlasGlyphCount,
    curves: atlas.curveCount,
    components: atlas.componentCount,
    bytes: atlas.layout.totalLength,
  };
  targetBridge.discardSlugAtlas(atlas.generation);
  return { milliseconds, signature };
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function statistics(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    samples: sorted,
  };
}

function verifySignature(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Slug atlas counts changed between preparations");
  }
}

try {
  const opened = measure(() => bridge.openWorkspace(sourcePath, storePath));
  const cold = prepare(bridge);
  bridge.saveWorkspaceAs(packagePath);
  bridge.closeWorkspace();

  const resumeSamples = [];
  const authoredCompilationSamples = [];
  const alignedPrepareSamples = [];
  const previewSamples = [];
  let warmBridge;
  for (let index = 0; index < resumeIterations; index++) {
    const resumedBridge = new Bridge();
    bridges.push(resumedBridge);
    const resumed = measure(() => resumedBridge.resumeWorkspaceForSource(storePath, packagePath));
    const authoredCompilation = measure(() => resumedBridge.prepareAuthoredGlyphCompilation());
    const alignedPrepare = prepare(resumedBridge);
    verifySignature(alignedPrepare.signature, cold.signature);

    resumeSamples.push(resumed.milliseconds);
    authoredCompilationSamples.push(authoredCompilation.milliseconds);
    alignedPrepareSamples.push(alignedPrepare.milliseconds);
    previewSamples.push(authoredCompilation.milliseconds + alignedPrepare.milliseconds);

    if (index === resumeIterations - 1) {
      warmBridge = resumedBridge;
    } else {
      resumedBridge.closeWorkspace();
    }
  }

  const warm = Array.from({ length: warmIterations }, () => prepare(warmBridge));
  for (const sample of warm) verifySignature(sample.signature, cold.signature);

  console.log(
    JSON.stringify(
      {
        sourcePath,
        warmIterations,
        resumeIterations,
        openMs: opened.milliseconds,
        coldPrepareMs: cold.milliseconds,
        resumeMs: statistics(resumeSamples),
        resumedAuthoredCompilationMs: statistics(authoredCompilationSamples),
        resumedAlignedPrepareMs: statistics(alignedPrepareSamples),
        resumedPreviewMs: statistics(previewSamples),
        warmPrepareMs: statistics(warm.map((sample) => sample.milliseconds)),
        signature: cold.signature,
      },
      null,
      2,
    ),
  );
} finally {
  for (const openBridge of bridges) {
    try {
      openBridge.closeWorkspace();
    } catch {
      // The workspace may not have opened or may already be closed.
    }
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}
