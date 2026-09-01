import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

const sourceArgument = process.argv[2];
if (!sourceArgument) {
  throw new Error("usage: node scripts/profile-slug-atlas.mjs <font-source> [iterations]");
}

const iterations = Number.parseInt(process.argv[3] ?? "10", 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error(`invalid iteration count: ${process.argv[3]}`);
}

const sourcePath = isAbsolute(sourceArgument) ? sourceArgument : resolve(sourceArgument);
const tempDirectory = mkdtempSync(join(tmpdir(), "shift-slug-profile-"));
const storePath = join(tempDirectory, "working.sqlite");
const recoveryPath = join(tempDirectory, "recovery.sqlite");
const bridge = new Bridge();
const document = extname(sourcePath).toLowerCase() === ".shift";

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - started };
}

async function prepare(glyphIds) {
  const started = performance.now();
  const atlas = glyphIds
    ? bridge.prepareSlugAtlasPage(glyphIds, 256)
    : bridge.prepareSlugAtlas(256);
  const prepareMilliseconds = performance.now() - started;
  const signature = {
    rootGlyphs: atlas.glyphs.length,
    atlasGlyphs: atlas.atlasGlyphCount,
    curves: atlas.curveCount,
    components: atlas.componentCount,
    bytes: atlas.layout.totalLength,
  };
  const streamStarted = performance.now();
  const stream = glyphIds
    ? bridge.streamSlugAtlasPage(atlas.generation, 4 * 1024 * 1024)
    : bridge.streamSlugAtlas(atlas.generation, 4 * 1024 * 1024);
  const reader = stream.getReader();
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes !== signature.bytes) {
    throw new Error(`Slug atlas streamed ${bytes} bytes; expected ${signature.bytes}`);
  }

  return {
    prepareMilliseconds,
    streamMilliseconds: performance.now() - streamStarted,
    signature,
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

try {
  const opened = document
    ? measure(() => bridge.openDocument(sourcePath, recoveryPath))
    : measure(() => bridge.openWorkspace(sourcePath, storePath));
  const glyphs = bridge.getGlyphs();
  const pages = document
    ? Array.from({ length: Math.ceil(glyphs.length / 256) }, (_, pageIndex) =>
        glyphs.slice(pageIndex * 256, (pageIndex + 1) * 256).map((glyph) => glyph.id),
      )
    : [null];
  const coldStarted = performance.now();
  const cold = [];
  for (const glyphIds of pages) cold.push(await prepare(glyphIds));
  const coldPageSetMilliseconds = performance.now() - coldStarted;
  const warm = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    const samples = [];
    for (const glyphIds of pages) samples.push(await prepare(glyphIds));
    for (let pageIndex = 0; pageIndex < samples.length; pageIndex += 1) {
      if (
        JSON.stringify(samples[pageIndex].signature) !== JSON.stringify(cold[pageIndex].signature)
      ) {
        throw new Error(`Slug atlas counts changed for page ${pageIndex}`);
      }
    }
    warm.push({ milliseconds: performance.now() - started, pages: samples });
  }

  const samples = warm.map((sample) => sample.milliseconds).sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        sourcePath,
        openKind: document ? "document" : "source",
        iterations,
        openMs: opened.milliseconds,
        glyphCount: glyphs.length,
        pageCount: pages.length,
        coldPageSetMs: coldPageSetMilliseconds,
        coldPages: cold.map((sample, pageIndex) => ({ pageIndex, ...sample })),
        warmPageSetMs: {
          p50: percentile(samples, 0.5),
          p95: percentile(samples, 0.95),
          samples,
        },
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
