import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mintAxisId, mintGlyphId, mintSourceId, type GlyphId, type SlugAtlas } from "@shift/types";
import {
  closeCachedAtlas,
  loadCachedAtlasPage,
  openCachedAtlas,
  pruneCachedAtlases,
  publishCachedAtlas,
  stageCachedAtlasPage,
} from "./CachedAtlas";
import type { CachedAtlasKey, CachedAtlasPageRequest, StagedCachedAtlasPage } from "./types";

const glyphA = mintGlyphId();
const glyphB = mintGlyphId();
const source = mintSourceId();
const axis = mintAxisId();

describe("CachedAtlas keeps only validated latest document pages", () => {
  let rootPath: string;

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "shift-cached-atlas-"));
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  it("round trips independently compressed fixed pages", async () => {
    const key = cacheKey("document-a", "revision-1");
    const first = await stagePage(key, 0, 2, [glyphA], Uint8Array.of(1, 2, 3));
    const second = await stagePage(key, 1, 2, [glyphB], Uint8Array.of(4, 5));
    await publish(key, [first, second], [0, 1]);

    const request = pageRequest(key, 1, [glyphB], [0, 1]);
    const opened = await openCachedAtlas(rootPath, request);
    if (!opened) throw new Error("expected CachedAtlas to open");

    try {
      const page = await loadCachedAtlasPage(opened, request);
      expect(page?.atlas.glyphs.map((glyph) => glyph.glyphId)).toEqual([glyphB]);
      expect(page?.atlas.weightSets[0]?.basis.basis.deltas[0]?.values).toBeInstanceOf(Float64Array);
      expect(await readOpened(page)).toEqual(Uint8Array.of(4, 5));
    } finally {
      await closeCachedAtlas(opened);
    }
  });

  it("falls back to a miss when a compressed page is corrupt", async () => {
    const key = cacheKey("document-a", "revision-1");
    const staged = await stagePage(key, 0, 1, [glyphA], Uint8Array.of(1, 2, 3));
    await publish(key, [staged], [0]);
    const filePath = publishedFiles()[0]!;
    const bytes = fs.readFileSync(filePath);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(filePath, bytes);

    const bytesAfterCorruption = await readPage(pageRequest(key, 0, [glyphA], [0]));

    expect(bytesAfterCorruption).toBeNull();
    expect(publishedFiles()).toEqual([]);
  });

  it("retains the most recently used entry under the global byte budget", async () => {
    const firstKey = cacheKey("document-a", "revision-1");
    const secondKey = cacheKey("document-b", "revision-1");
    const first = await stagePage(firstKey, 0, 1, [glyphA], Uint8Array.of(1, 2, 3));
    await publish(firstKey, [first], [0]);
    const second = await stagePage(secondKey, 0, 1, [glyphB], Uint8Array.of(4, 5, 6));
    const budget = await publish(secondKey, [second], [0]);
    await readPage(pageRequest(firstKey, 0, [glyphA], [0]));

    await pruneCachedAtlases(rootPath, budget);

    expect(await readPage(pageRequest(secondKey, 0, [glyphB], [0]))).toBeNull();
    expect(await readPage(pageRequest(firstKey, 0, [glyphA], [0]))).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("publishes a new revision only after every replacement page is ready", async () => {
    const oldKey = cacheKey("document-a", "revision-1");
    const oldPages = await stageBoth(oldKey, Uint8Array.of(1), Uint8Array.of(2));
    await publish(oldKey, oldPages, [0, 1]);
    const newKey = cacheKey("document-a", "revision-2");
    const first = await stagePage(newKey, 0, 2, [glyphA], Uint8Array.of(3));

    const result = await publishAttempt(newKey, [first], [0, 1]);

    expect(result).toBeNull();
    expect(await readPage(pageRequest(oldKey, 1, [glyphB], [0, 1]))).toEqual(Uint8Array.of(2));
  });

  it("carries unchanged pages into the latest document revision", async () => {
    const oldKey = cacheKey("document-a", "revision-1");
    await publish(oldKey, await stageBoth(oldKey, Uint8Array.of(1), Uint8Array.of(2)), [0, 1]);
    const newKey = cacheKey("document-a", "revision-2");
    const replacement = await stagePage(newKey, 0, 2, [glyphA], Uint8Array.of(3));

    await publish(newKey, [replacement], [0], 2);

    expect(await readPage(pageRequest(oldKey, 0, [glyphA], [0]))).toBeNull();
    expect(publishedFiles()).toHaveLength(1);
    expect(await readPage(pageRequest(newKey, 1, [glyphB], [0]))).toEqual(Uint8Array.of(2));
  });

  it("loads every fixed page from one validated index", async () => {
    const key = cacheKey("document-a", "revision-1");
    await publish(key, await stageBoth(key, Uint8Array.of(1), Uint8Array.of(2)), [0, 1]);
    const firstRequest = pageRequest(key, 0, [glyphA], [0, 1]);
    const opened = await openCachedAtlas(rootPath, firstRequest);
    if (!opened) throw new Error("expected CachedAtlas to open");
    corruptPublishedIndex();

    try {
      expect(await readOpened(await loadCachedAtlasPage(opened, firstRequest))).toEqual(
        Uint8Array.of(1),
      );
      const secondRequest = pageRequest(key, 1, [glyphB], [0, 1]);
      expect(await readOpened(await loadCachedAtlasPage(opened, secondRequest))).toEqual(
        Uint8Array.of(2),
      );
    } finally {
      await closeCachedAtlas(opened);
    }
  });

  async function readPage(request: CachedAtlasPageRequest): Promise<Uint8Array | null> {
    const opened = await openCachedAtlas(rootPath, request);
    if (!opened) return null;

    try {
      return await readOpened(await loadCachedAtlasPage(opened, request));
    } finally {
      await closeCachedAtlas(opened);
    }
  }

  function corruptPublishedIndex(): void {
    const filePath = publishedFiles()[0]!;
    const bytes = fs.readFileSync(filePath);
    bytes[12] ^= 0xff;
    fs.writeFileSync(filePath, bytes);
  }

  async function stagePage(
    key: CachedAtlasKey,
    pageIndex: number,
    totalPages: number,
    glyphIds: GlyphId[],
    bytes: Uint8Array,
  ): Promise<StagedCachedAtlasPage> {
    const request = pageRequest(key, pageIndex, glyphIds, [0, 1].slice(0, totalPages));
    const sink = stageCachedAtlasPage(rootPath, request, descriptor(glyphIds, bytes.length));
    await sink.write(bytes);
    return sink.complete();
  }

  async function stageBoth(
    key: CachedAtlasKey,
    first: Uint8Array,
    second: Uint8Array,
  ): Promise<StagedCachedAtlasPage[]> {
    return Promise.all([
      stagePage(key, 0, 2, [glyphA], first),
      stagePage(key, 1, 2, [glyphB], second),
    ]);
  }

  async function publish(
    key: CachedAtlasKey,
    pages: StagedCachedAtlasPage[],
    replacementPageIndices: number[],
    totalPages?: number,
  ): Promise<number> {
    const published = await publishAttempt(key, pages, replacementPageIndices, totalPages);
    if (published === null) throw new Error("expected CachedAtlas publication");
    return published;
  }

  function publishAttempt(
    key: CachedAtlasKey,
    pages: StagedCachedAtlasPage[],
    replacementPageIndices: number[],
    totalPages?: number,
  ): Promise<number | null> {
    return publishCachedAtlas(rootPath, {
      key,
      alignment: 256,
      pageCount:
        totalPages ??
        (pages.some((page) => page.pageIndex === 1) || replacementPageIndices.length > 1 ? 2 : 1),
      replacementPageIndices,
      stagedPages: new Map(pages.map((page) => [page.pageIndex, page])),
    });
  }

  function publishedFiles(): string[] {
    return fs
      .readdirSync(rootPath)
      .filter((name) => name.endsWith(".atlas"))
      .map((name) => path.join(rootPath, name));
  }
});

function cacheKey(documentKey: string, revisionKey: string): CachedAtlasKey {
  return { documentKey, revisionKey };
}

function pageRequest(
  key: CachedAtlasKey,
  pageIndex: number,
  glyphIds: GlyphId[],
  replacementPageIndices: number[],
): CachedAtlasPageRequest {
  return {
    key,
    alignment: 256,
    pageIndex,
    pageCount: replacementPageIndices.length > 1 || pageIndex === 1 ? 2 : 1,
    glyphIds,
    replacementPageIndices,
  };
}

function descriptor(glyphIds: GlyphId[], totalLength: number): SlugAtlas {
  const empty = { offset: 0, length: 0 };
  return {
    generation: 1,
    bandCount: 16,
    weightCount: 1,
    layout: {
      baseCurves: empty,
      curveDeltas: empty,
      sparseDeltas: empty,
      glyphs: empty,
      sources: empty,
      sourceAdvances: empty,
      componentGlyphs: empty,
      componentParts: empty,
      components: empty,
      componentSources: empty,
      anchorSources: empty,
      lineBits: empty,
      totalLength,
    },
    previewExtents: { horizontal: 0, minimumY: 0, maximumY: 0 },
    glyphs: glyphIds.map((glyphId) => ({ glyphId, defaultGlyph: 0, exactSources: [] })),
    weightSets: [
      {
        basis: {
          sourceIds: [source],
          basis: {
            deltas: [
              {
                region: [{ axisId: axis, lower: -1, peak: 0, upper: 1 }],
                values: new Float64Array([1]),
              },
            ],
          },
        },
        sourceWeightIndices: [0],
      },
    ],
    atlasGlyphCount: glyphIds.length,
    curveCount: 0,
    componentCount: 0,
  };
}

async function readOpened(
  opened: Awaited<ReturnType<typeof loadCachedAtlasPage>>,
): Promise<Uint8Array | null> {
  if (!opened) return null;

  const reader = opened.stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
