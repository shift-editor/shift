import { createBridge } from "@shift/bridge";
import { decodeOutline } from "@shift/glyph-codec";
import type { GlyphPreview, PackedGlyphPreview } from "@shift/types";
import { chromium, type Browser } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";

const DEFAULT_CJK_FONT = "/usr/share/fonts/opentype/unifont/unifont_jp.otf";
const CHUNK_SIZE = 400;
const SAMPLE_COUNT = 7;
const PREVIEW_BUDGET_BYTES = 256 * 1024 * 1024;
const CACHE_ENTRY_OVERHEAD_BYTES = 64;

type BrowserMeasurements = {
  readonly svgPathConstructionMs: number;
  readonly packedPathConstructionMs: number;
  readonly svgPathHeapDeltaBytes: number | null;
  readonly packedPathHeapDeltaBytes: number | null;
  readonly svgGcMs: number | null;
  readonly packedGcMs: number | null;
};

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

/** Samples across the complete catalog instead of biasing measurements toward Latin glyphs. */
function uniformSample<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values];

  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.floor(((index + 0.5) * values.length) / count);
    return values[sourceIndex]!;
  });
}

function measure<T>(action: () => T): { value: T; milliseconds: number } {
  const start = performance.now();
  const value = action();
  return { value, milliseconds: performance.now() - start };
}

async function structuredCloneMilliseconds(value: unknown): Promise<number> {
  const channel = new MessageChannel();
  const received = new Promise<void>((resolve) => channel.port2.once("message", () => resolve()));
  const start = performance.now();
  channel.port1.postMessage(value);
  await received;
  const milliseconds = performance.now() - start;
  channel.port1.close();
  channel.port2.close();
  return milliseconds;
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.SHIFT_BENCHMARK_CHROMIUM;
  return chromium.launch({
    executablePath: executablePath || undefined,
    headless: true,
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
  });
}

async function measureBrowserPaths(
  svg: readonly GlyphPreview[],
  packed: readonly PackedGlyphPreview[],
): Promise<BrowserMeasurements | null> {
  let browser: Browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.warn("Browser Path2D measurements unavailable", error);
    return null;
  }

  try {
    const page = await browser.newPage();
    // tsx names nested functions with this helper before Playwright serializes
    // the callback; define it in the benchmark page as well.
    await page.addScriptTag({ content: "globalThis.__name = (target) => target;" });
    return await page.evaluate(
      ({ svgPaths, packedBytes }) => {
        type MemoryInfo = Performance & {
          memory?: { usedJSHeapSize: number };
        };
        type GcGlobal = typeof globalThis & { gc?: () => void };

        const replay = (bytes: Uint8Array): Path2D => {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const commandCount = view.getUint32(8, true);
          let coordinateOffset = 16 + Math.ceil(commandCount / 4) * 4;
          const path = new Path2D();
          const next = (): number => {
            const value = view.getFloat32(coordinateOffset, true);
            coordinateOffset += 4;
            return value;
          };

          for (let index = 0; index < commandCount; index += 1) {
            switch (bytes[16 + index]) {
              case 0:
                path.moveTo(next(), next());
                break;
              case 1:
                path.lineTo(next(), next());
                break;
              case 2:
                path.quadraticCurveTo(next(), next(), next(), next());
                break;
              case 3:
                path.bezierCurveTo(next(), next(), next(), next(), next(), next());
                break;
              case 4:
                path.closePath();
                break;
            }
          }
          return path;
        };

        const memory = performance as MemoryInfo;
        const gc = (globalThis as GcGlobal).gc;
        const measurePaths = (build: () => Path2D[]) => {
          gc?.();
          const before = memory.memory?.usedJSHeapSize ?? null;
          const start = performance.now();
          let retained = build();
          const milliseconds = performance.now() - start;
          const after = memory.memory?.usedJSHeapSize ?? null;
          retained = [];
          const gcStart = performance.now();
          gc?.();
          const gcMilliseconds = gc ? performance.now() - gcStart : null;
          if (retained.length !== 0) throw new Error("path release invariant failed");
          return {
            milliseconds,
            heapDeltaBytes: before === null || after === null ? null : after - before,
            gcMilliseconds,
          };
        };

        const packedViews = packedBytes.map((bytes) => Uint8Array.from(bytes));
        // Warm constructors before the measured representative chunk.
        if (svgPaths[0]) new Path2D(svgPaths[0]);
        if (packedViews[0]) replay(packedViews[0]);
        const svgResult = measurePaths(() => svgPaths.map((path) => new Path2D(path)));
        const packedResult = measurePaths(() => packedViews.map(replay));

        return {
          svgPathConstructionMs: svgResult.milliseconds,
          packedPathConstructionMs: packedResult.milliseconds,
          svgPathHeapDeltaBytes: svgResult.heapDeltaBytes,
          packedPathHeapDeltaBytes: packedResult.heapDeltaBytes,
          svgGcMs: svgResult.gcMilliseconds,
          packedGcMs: packedResult.gcMilliseconds,
        };
      },
      {
        svgPaths: svg.map((preview) => preview.svgPath),
        packedBytes: packed.map((preview) => [...preview.data]),
      },
    );
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fontPath = args.find((argument) => !argument.startsWith("--")) ?? DEFAULT_CJK_FONT;
  const measureFullPayload = args.includes("--full-size");
  if (!fs.existsSync(fontPath)) throw new Error(`font does not exist: ${fontPath}`);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-outline-benchmark-"));
  const storePath = path.join(temporaryRoot, "document.sqlite");
  const bridge = createBridge();
  let workspaceOpen = false;

  try {
    const open = measure(() => {
      bridge.openWorkspace(fontPath, storePath);
      workspaceOpen = true;
    });
    const glyphs = bridge.getGlyphs();
    const glyphIds = uniformSample(glyphs, CHUNK_SIZE).map((glyph) => glyph.id);
    const location = bridge.mapLocation({ values: {} });

    // Warm native resolution and generated bindings before collecting medians.
    bridge.getGlyphPreviews(glyphIds, location);
    bridge.getPackedGlyphPreviews(glyphIds, location);

    const svgSamples: number[] = [];
    const packedSamples: number[] = [];
    let svg: GlyphPreview[] = [];
    let packed: PackedGlyphPreview[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const svgSample = measure(() => bridge.getGlyphPreviews(glyphIds, location));
      const packedSample = measure(() => bridge.getPackedGlyphPreviews(glyphIds, location));
      svg = svgSample.value;
      packed = packedSample.value;
      svgSamples.push(svgSample.milliseconds);
      packedSamples.push(packedSample.milliseconds);
    }

    const decodeSamples: number[] = [];
    let iteratedCommands = 0;
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const decoded = measure(() => {
        let commands = 0;
        for (const preview of packed) {
          for (const _command of decodeOutline(preview.data)) commands += 1;
        }
        return commands;
      });
      iteratedCommands = decoded.value;
      decodeSamples.push(decoded.milliseconds);
    }

    const svgCloneSamples: number[] = [];
    const packedCloneSamples: number[] = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      svgCloneSamples.push(await structuredCloneMilliseconds(svg));
      packedCloneSamples.push(await structuredCloneMilliseconds(packed));
    }

    const browser = await measureBrowserPaths(svg, packed);
    let fullPackedPayload: Record<string, number | boolean> | null = null;
    if (measureFullPayload) {
      const sizes: number[] = [];
      const fullStart = performance.now();
      for (let offset = 0; offset < glyphs.length; offset += CHUNK_SIZE) {
        const batchIds = glyphs.slice(offset, offset + CHUNK_SIZE).map((glyph) => glyph.id);
        const batch = bridge.getPackedGlyphPreviews(batchIds, location);
        for (const preview of batch) sizes.push(preview.data.byteLength);
      }

      sizes.sort((left, right) => left - right);
      const payloadBytes = sizes.reduce((total, size) => total + size, 0);
      const cacheLedgerBytes = payloadBytes + sizes.length * CACHE_ENTRY_OVERHEAD_BYTES;
      fullPackedPayload = {
        glyphs: sizes.length,
        payloadBytes,
        cacheLedgerBytes,
        meanBytes: payloadBytes / sizes.length,
        p50Bytes: percentile(sizes, 0.5),
        p95Bytes: percentile(sizes, 0.95),
        p99Bytes: percentile(sizes, 0.99),
        maxBytes: sizes.at(-1) ?? 0,
        generationMs: performance.now() - fullStart,
        previewBudgetBytes: PREVIEW_BUDGET_BYTES,
        fitsPreviewBudget: cacheLedgerBytes <= PREVIEW_BUDGET_BYTES,
        budgetFraction: cacheLedgerBytes / PREVIEW_BUDGET_BYTES,
      };
    }

    const svgUtf8Bytes = svg.reduce(
      (total, preview) => total + Buffer.byteLength(preview.svgPath, "utf8"),
      0,
    );
    const svgUtf16Bytes = svg.reduce((total, preview) => total + preview.svgPath.length * 2, 0);
    const packedBytes = packed.reduce((total, preview) => total + preview.data.byteLength, 0);

    console.log(
      JSON.stringify(
        {
          fontPath,
          importedGlyphs: glyphs.length,
          requestedGlyphs: glyphIds.length,
          sampleStrategy: "uniform-across-catalog",
          returnedSvgGlyphs: svg.length,
          returnedPackedGlyphs: packed.length,
          openMs: open.milliseconds,
          payload: {
            svgUtf8Bytes,
            svgUtf16Bytes,
            packedBytes,
            packedVsSvgUtf8Ratio: packedBytes / svgUtf8Bytes,
          },
          napiMedianMs: {
            svg: median(svgSamples),
            packed: median(packedSamples),
          },
          structuredCloneMedianMs: {
            svg: median(svgCloneSamples),
            packed: median(packedCloneSamples),
          },
          typescriptValidateAndIterateMedianMs: median(decodeSamples),
          packedWarmup400Ms:
            median(packedSamples) +
            median(packedCloneSamples) +
            median(decodeSamples) +
            (browser?.packedPathConstructionMs ?? 0),
          iteratedCommands,
          browser,
          fullPackedPayload,
        },
        null,
        2,
      ),
    );
  } finally {
    if (workspaceOpen) bridge.closeWorkspace();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
