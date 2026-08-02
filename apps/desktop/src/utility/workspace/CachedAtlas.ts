import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress, createZstdDecompress } from "node:zlib";
import type {
  GlyphId,
  InterpolationBasis,
  SlugAtlas,
  SlugGlyph,
  SlugWeightSet,
} from "@shift/types";
import { z } from "zod";
import type {
  CachedAtlas,
  CachedAtlasFile,
  CachedAtlasKey,
  CachedAtlasPage,
  CachedAtlasPageRequest,
  CachedAtlasPageSink,
  CachedAtlasPublication,
  CachedSlugAtlas,
  OpenedCachedAtlasPage,
  StagedCachedAtlasPage,
} from "./types";

export const DEFAULT_ATLAS_CACHE_BYTE_BUDGET = 1024 * 1024 * 1024;

const FORMAT = "shift.slug-atlas-cache.v1" as const;
const MAGIC = Buffer.from("SHATLAS1");
const INDEX_CHECKSUM_BYTES = 32;
const INDEX_CHECKSUM_OFFSET = MAGIC.byteLength + 4;
const HEADER_BYTES = INDEX_CHECKSUM_OFFSET + INDEX_CHECKSUM_BYTES;
const MAXIMUM_INDEX_BYTES = 64 * 1024 * 1024;
const STAGING_SESSION = `${process.pid}-${crypto.randomUUID()}`;
let lastTouchMilliseconds = 0;

const nonnegativeInteger = z.number().int().nonnegative().safe();
const finiteNumber = z.number().finite();
const sectionSchema = z
  .object({
    offset: nonnegativeInteger,
    length: nonnegativeInteger,
  })
  .strict();
const interpolationSupportSchema = z
  .object({
    axisId: z.string(),
    lower: finiteNumber,
    peak: finiteNumber,
    upper: finiteNumber,
  })
  .strict();
const interpolationBasisSchema = z
  .object({
    sourceIds: z.array(z.string()),
    regions: z.array(z.array(interpolationSupportSchema)),
    coefficients: z.array(z.array(finiteNumber)),
  })
  .strict();
const slugAtlasSchema = z
  .object({
    bandCount: nonnegativeInteger,
    weightCount: nonnegativeInteger,
    layout: z
      .object({
        baseCurves: sectionSchema,
        curveDeltas: sectionSchema,
        sparseDeltas: sectionSchema,
        glyphs: sectionSchema,
        sources: sectionSchema,
        sourceAdvances: sectionSchema,
        componentGlyphs: sectionSchema,
        componentParts: sectionSchema,
        components: sectionSchema,
        componentSources: sectionSchema,
        anchorSources: sectionSchema,
        lineBits: sectionSchema,
        totalLength: nonnegativeInteger,
      })
      .strict(),
    previewExtents: z
      .object({
        horizontal: finiteNumber,
        minimumY: finiteNumber,
        maximumY: finiteNumber,
      })
      .strict(),
    glyphs: z.array(
      z
        .object({
          glyphId: z.string(),
          defaultGlyph: nonnegativeInteger,
          exactSources: z.array(
            z
              .object({
                sourceId: z.string(),
                glyphIndex: nonnegativeInteger,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    weightSets: z.array(
      z
        .object({
          basis: interpolationBasisSchema,
          sourceWeightIndices: z.array(nonnegativeInteger),
        })
        .strict(),
    ),
    atlasGlyphCount: nonnegativeInteger,
    curveCount: nonnegativeInteger,
    componentCount: nonnegativeInteger,
  })
  .strict();
const cachedAtlasPageSchema = z
  .object({
    pageIndex: nonnegativeInteger,
    glyphIds: z.array(z.string()),
    atlas: slugAtlasSchema,
    compressedOffset: nonnegativeInteger,
    compressedLength: nonnegativeInteger,
    decodedLength: nonnegativeInteger,
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const cachedAtlasSchema = z
  .object({
    format: z.literal(FORMAT),
    documentKey: z.string(),
    revisionKey: z.string(),
    bandCount: nonnegativeInteger,
    alignment: nonnegativeInteger,
    pageCount: nonnegativeInteger,
    pages: z.array(cachedAtlasPageSchema),
  })
  .strict();

/** Starts independent Zstd compression for one completed native page stream. */
export function stageCachedAtlasPage(
  rootPath: string,
  request: CachedAtlasPageRequest,
  descriptor: SlugAtlas,
): CachedAtlasPageSink {
  validatePageRequest(request);
  const filePath = stagedPagePath(rootPath, request.key, request.pageIndex);
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const compressor = createZstdCompress();
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  const compression = pipeline(compressor, output);
  compression.catch(() => {});
  let decodedLength = 0;
  let settled = false;

  return {
    async write(bytes): Promise<void> {
      if (settled) throw new Error("cached atlas page sink is already settled");
      decodedLength += bytes.byteLength;
      if (!Number.isSafeInteger(decodedLength)) {
        throw new Error("cached atlas decoded length exceeds safe integer range");
      }
      if (!compressor.write(bytes)) await once(compressor, "drain");
    },

    async complete(): Promise<StagedCachedAtlasPage> {
      if (settled) throw new Error("cached atlas page sink is already settled");
      settled = true;
      compressor.end();

      try {
        await compression;
        if (decodedLength !== descriptor.layout.totalLength) {
          throw new Error(
            `cached atlas page wrote ${decodedLength} bytes; expected ${descriptor.layout.totalLength}`,
          );
        }

        await fs.promises.rename(temporaryPath, filePath);
        const compressedLength = (await fs.promises.stat(filePath)).size;
        const checksum = await checksumFile(filePath);
        const atlas = withoutGeneration(descriptor);

        return {
          pageIndex: request.pageIndex,
          glyphIds: [...request.glyphIds],
          atlas,
          filePath,
          compressedLength,
          decodedLength,
          checksum,
        };
      } catch (error) {
        await removeFiles([temporaryPath, filePath]);
        throw error;
      }
    },

    async discard(): Promise<void> {
      if (!settled) {
        settled = true;
        compressor.destroy(new Error("cached atlas page staging discarded"));
      }

      try {
        await compression;
      } catch {
        // Discard owns this expected stream failure.
      }
      await removeFiles([temporaryPath, filePath]);
    },
  };
}

/** Opens and validates one fixed page from the latest matching document entry. */
export async function openCachedAtlas(
  rootPath: string,
  request: CachedAtlasPageRequest,
): Promise<OpenedCachedAtlasPage | null> {
  validatePageRequest(request);
  const filePath = cachedAtlasPath(rootPath, request.key.documentKey);

  try {
    const cached = await readCachedAtlas(filePath);
    if (
      cached.documentKey !== request.key.documentKey ||
      cached.revisionKey !== request.key.revisionKey ||
      cached.alignment !== request.alignment ||
      cached.pageCount !== request.pageCount
    ) {
      return null;
    }

    const page = cached.pages.find((candidate) => candidate.pageIndex === request.pageIndex);
    if (!page || !sameGlyphIds(page.glyphIds, request.glyphIds)) return null;

    const payloadOffset = await payloadStart(filePath);
    const checksum = await checksumFileRange(
      filePath,
      payloadOffset + page.compressedOffset,
      page.compressedLength,
    );
    if (checksum !== page.checksum) {
      await removeCachedAtlas(filePath);
      return null;
    }

    const descriptor = withTypedCoefficients(page.atlas);
    const fileDescriptor = fs.openSync(filePath, "r");
    const compressed = fs.createReadStream(filePath, {
      fd: fileDescriptor,
      autoClose: true,
      start: payloadOffset + page.compressedOffset,
      end: payloadOffset + page.compressedOffset + page.compressedLength - 1,
    });
    const decompressed = compressed.pipe(createZstdDecompress());
    await touchCachedAtlas(filePath);

    return {
      atlas: descriptor,
      stream: Readable.toWeb(decompressed) as OpenedCachedAtlasPage["stream"],
    };
  } catch {
    await removeCachedAtlas(filePath);
    return null;
  }
}

/** Publishes a complete latest entry, carrying forward only declared unchanged pages. */
export async function publishCachedAtlas(
  rootPath: string,
  publication: CachedAtlasPublication,
): Promise<number | null> {
  validatePublication(publication);
  const targetPath = cachedAtlasPath(rootPath, publication.key.documentKey);
  const replacementIndices = new Set(publication.replacementPageIndices);
  if ([...replacementIndices].some((pageIndex) => !publication.stagedPages.has(pageIndex))) {
    return null;
  }

  const previous = await readCarrySource(targetPath, publication, replacementIndices);
  if (!previous && publication.stagedPages.size < publication.pageCount) return null;

  const pages: CachedAtlasPage[] = [];
  let compressedOffset = 0;
  for (let pageIndex = 0; pageIndex < publication.pageCount; pageIndex += 1) {
    const staged = publication.stagedPages.get(pageIndex);
    const carried = previous?.cached.pages.find((page) => page.pageIndex === pageIndex);
    const page = staged
      ? stagedPage(staged, compressedOffset)
      : carried
        ? { ...carried, compressedOffset }
        : null;
    if (!page) return null;

    pages.push(page);
    compressedOffset += page.compressedLength;
  }

  const bandCount = pages[0]?.atlas.bandCount;
  if (bandCount === undefined || pages.some((page) => page.atlas.bandCount !== bandCount)) {
    throw new Error("cached atlas pages disagree about band count");
  }
  const cached: CachedAtlas = {
    format: FORMAT,
    ...publication.key,
    bandCount,
    alignment: publication.alignment,
    pageCount: publication.pageCount,
    pages,
  };
  const index = Buffer.from(JSON.stringify(cached, typedArrayReplacer));
  if (index.byteLength > MAXIMUM_INDEX_BYTES) {
    throw new Error("cached atlas index exceeds the supported size");
  }

  const temporaryPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const output = await fs.promises.open(temporaryPath, "wx");

  try {
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32LE(index.byteLength, MAGIC.byteLength);
    crypto.createHash("sha256").update(index).digest().copy(header, INDEX_CHECKSUM_OFFSET);
    await output.writeFile(header);
    await output.writeFile(index);

    for (const page of pages) {
      const staged = publication.stagedPages.get(page.pageIndex);
      if (staged) {
        await copyFileInto(staged.filePath, output);
        continue;
      }

      if (!previous) throw new Error("cached atlas carry source disappeared");
      const carried = previous.cached.pages[page.pageIndex];
      if (!carried) throw new Error("cached atlas carry page disappeared");
      await copyRangeInto(
        targetPath,
        previous.payloadOffset + carried.compressedOffset,
        carried.compressedLength,
        output,
      );
    }

    await output.sync();
    await output.close();
    await fs.promises.rename(temporaryPath, targetPath);
    await touchCachedAtlas(targetPath);
    await removeFiles([...publication.stagedPages.values()].map((page) => page.filePath));
    return (await fs.promises.stat(targetPath)).size;
  } catch (error) {
    await output.close().catch(() => {});
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Removes least-recently-used published entries until the global byte budget is met. */
export async function pruneCachedAtlases(rootPath: string, byteBudget: number): Promise<void> {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) {
    throw new Error("cached atlas byte budget must be a non-negative safe integer");
  }
  if (!fs.existsSync(rootPath)) return;
  await removeAbandonedStaging(rootPath);

  const entries: CachedAtlasFile[] = [];
  for (const name of await fs.promises.readdir(rootPath)) {
    if (!name.endsWith(".atlas")) continue;

    const filePath = path.join(rootPath, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) entries.push({ filePath, name, bytes: stat.size, touched: stat.mtimeMs });
    } catch {
      // A concurrent utility may have replaced or removed this disposable entry.
    }
  }

  let totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  entries.sort(
    (left, right) => left.touched - right.touched || left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (totalBytes <= byteBudget) break;

    try {
      await fs.promises.rm(entry.filePath, { force: true });
      totalBytes -= entry.bytes;
    } catch {
      // Another utility owns the same global budget and may already have removed it.
    }
  }
}

function validatePageRequest(request: CachedAtlasPageRequest): void {
  if (
    !Number.isSafeInteger(request.alignment) ||
    request.alignment < 1 ||
    !Number.isSafeInteger(request.pageIndex) ||
    request.pageIndex < 0 ||
    !Number.isSafeInteger(request.pageCount) ||
    request.pageCount < 1 ||
    request.pageIndex >= request.pageCount
  ) {
    throw new Error("invalid cached atlas page request");
  }
  validatePageIndices(request.replacementPageIndices, request.pageCount);
}

function validatePublication(publication: CachedAtlasPublication): void {
  if (
    !Number.isSafeInteger(publication.alignment) ||
    publication.alignment < 1 ||
    !Number.isSafeInteger(publication.pageCount) ||
    publication.pageCount < 1
  ) {
    throw new Error("invalid cached atlas publication");
  }
  validatePageIndices(publication.replacementPageIndices, publication.pageCount);
}

function validatePageIndices(pageIndices: readonly number[], pageCount: number): void {
  const unique = new Set(pageIndices);
  if (
    unique.size !== pageIndices.length ||
    pageIndices.some(
      (pageIndex) => !Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount,
    )
  ) {
    throw new Error("invalid cached atlas replacement pages");
  }
}

function withoutGeneration(descriptor: SlugAtlas): CachedSlugAtlas {
  const { generation: _generation, ...atlas } = descriptor;
  return atlas;
}

function withTypedCoefficients(atlas: CachedSlugAtlas): CachedSlugAtlas {
  return {
    ...atlas,
    glyphs: atlas.glyphs as SlugGlyph[],
    weightSets: atlas.weightSets.map(
      (set): SlugWeightSet => ({
        ...set,
        basis: {
          ...set.basis,
          coefficients: set.basis.coefficients.map(
            (coefficients) => new Float64Array(coefficients),
          ),
        } as InterpolationBasis,
      }),
    ),
  };
}

function typedArrayReplacer(_key: string, value: unknown): unknown {
  return value instanceof Float64Array ? [...value] : value;
}

async function readCachedAtlas(filePath: string): Promise<CachedAtlas> {
  const file = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const headerRead = await file.read(header, 0, header.byteLength, 0);
    if (
      headerRead.bytesRead !== header.byteLength ||
      !header.subarray(0, MAGIC.byteLength).equals(MAGIC)
    ) {
      throw new Error("invalid cached atlas header");
    }

    const indexLength = header.readUInt32LE(MAGIC.byteLength);
    if (indexLength < 2 || indexLength > MAXIMUM_INDEX_BYTES) {
      throw new Error("invalid cached atlas index length");
    }
    const index = Buffer.alloc(indexLength);
    const indexRead = await file.read(index, 0, index.byteLength, HEADER_BYTES);
    if (indexRead.bytesRead !== index.byteLength) throw new Error("truncated cached atlas index");

    const expectedIndexChecksum = header.subarray(
      INDEX_CHECKSUM_OFFSET,
      INDEX_CHECKSUM_OFFSET + INDEX_CHECKSUM_BYTES,
    );
    const indexChecksum = crypto.createHash("sha256").update(index).digest();
    if (!crypto.timingSafeEqual(indexChecksum, expectedIndexChecksum)) {
      throw new Error("cached atlas index checksum does not match");
    }

    const parsed = cachedAtlasSchema.parse(JSON.parse(index.toString("utf8")));
    const cached = {
      ...parsed,
      pages: parsed.pages.map((page) => ({
        ...page,
        glyphIds: page.glyphIds as GlyphId[],
        atlas: withTypedCoefficients(page.atlas as unknown as CachedSlugAtlas),
      })),
    } satisfies CachedAtlas;
    await validateCachedAtlas(filePath, cached, HEADER_BYTES + indexLength);
    return cached;
  } finally {
    await file.close();
  }
}

async function validateCachedAtlas(
  filePath: string,
  cached: CachedAtlas,
  payloadOffset: number,
): Promise<void> {
  if (cached.pages.length !== cached.pageCount) {
    throw new Error("cached atlas page count does not match its index");
  }

  let compressedOffset = 0;
  for (let pageIndex = 0; pageIndex < cached.pageCount; pageIndex += 1) {
    const page = cached.pages[pageIndex];
    if (
      !page ||
      page.pageIndex !== pageIndex ||
      page.compressedOffset !== compressedOffset ||
      page.decodedLength !== page.atlas.layout.totalLength ||
      page.atlas.bandCount !== cached.bandCount
    ) {
      throw new Error("cached atlas page index is inconsistent");
    }
    compressedOffset += page.compressedLength;
  }

  const stat = await fs.promises.stat(filePath);
  if (payloadOffset + compressedOffset !== stat.size) {
    throw new Error("cached atlas payload length does not match its index");
  }
}

async function readCarrySource(
  targetPath: string,
  publication: CachedAtlasPublication,
  replacementIndices: ReadonlySet<number>,
) {
  try {
    const cached = await readCachedAtlas(targetPath);
    const stagedBandCount = publication.stagedPages.values().next().value?.atlas.bandCount;
    if (
      cached.documentKey !== publication.key.documentKey ||
      cached.alignment !== publication.alignment ||
      cached.pageCount !== publication.pageCount ||
      (stagedBandCount !== undefined && cached.bandCount !== stagedBandCount)
    ) {
      return null;
    }

    const start = await payloadStart(targetPath);
    for (const page of cached.pages) {
      if (replacementIndices.has(page.pageIndex)) continue;

      const checksum = await checksumFileRange(
        targetPath,
        start + page.compressedOffset,
        page.compressedLength,
      );
      if (checksum !== page.checksum) return null;
    }
    return { cached, payloadOffset: start };
  } catch {
    return null;
  }
}

function stagedPage(page: StagedCachedAtlasPage, compressedOffset: number): CachedAtlasPage {
  return {
    pageIndex: page.pageIndex,
    glyphIds: [...page.glyphIds],
    atlas: page.atlas,
    compressedOffset,
    compressedLength: page.compressedLength,
    decodedLength: page.decodedLength,
    checksum: page.checksum,
  };
}

async function payloadStart(filePath: string): Promise<number> {
  const file = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const result = await file.read(header, 0, header.byteLength, 0);
    if (result.bytesRead !== header.byteLength) throw new Error("truncated cached atlas header");
    return HEADER_BYTES + header.readUInt32LE(MAGIC.byteLength);
  } finally {
    await file.close();
  }
}

async function copyFileInto(sourcePath: string, output: fs.promises.FileHandle): Promise<void> {
  for await (const chunk of fs.createReadStream(sourcePath)) {
    await output.writeFile(chunk);
  }
}

async function copyRangeInto(
  sourcePath: string,
  offset: number,
  length: number,
  output: fs.promises.FileHandle,
): Promise<void> {
  if (length === 0) return;
  for await (const chunk of fs.createReadStream(sourcePath, {
    start: offset,
    end: offset + length - 1,
  })) {
    await output.writeFile(chunk);
  }
}

async function checksumFile(filePath: string): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  return checksumFileRange(filePath, 0, stat.size);
}

async function checksumFileRange(
  filePath: string,
  offset: number,
  length: number,
): Promise<string> {
  const hash = crypto.createHash("sha256");
  if (length === 0) return hash.digest("hex");

  for await (const chunk of fs.createReadStream(filePath, {
    start: offset,
    end: offset + length - 1,
  })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function removeAbandonedStaging(rootPath: string): Promise<void> {
  const stagingRoot = path.join(rootPath, "staging");
  if (!fs.existsSync(stagingRoot)) return;

  for (const name of await fs.promises.readdir(stagingRoot)) {
    if (name === STAGING_SESSION) continue;

    const processId = Number.parseInt(name.split("-", 1)[0] ?? "", 10);
    if (Number.isSafeInteger(processId) && processId > 0 && processIsRunning(processId)) continue;
    await fs.promises.rm(path.join(stagingRoot, name), { recursive: true, force: true });
  }
}

function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function touchCachedAtlas(filePath: string): Promise<void> {
  const milliseconds = Math.max(Date.now(), lastTouchMilliseconds + 1);
  lastTouchMilliseconds = milliseconds;
  const touched = new Date(milliseconds);
  await fs.promises.utimes(filePath, touched, touched);
}

function cachedAtlasPath(rootPath: string, documentKey: string): string {
  return path.join(rootPath, `${hashKey(documentKey)}.atlas`);
}

function stagedPagePath(rootPath: string, key: CachedAtlasKey, pageIndex: number): string {
  return path.join(
    rootPath,
    "staging",
    STAGING_SESSION,
    hashKey(key.documentKey),
    hashKey(key.revisionKey),
    `${pageIndex}.zst`,
  );
}

function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sameGlyphIds(left: readonly GlyphId[], right: readonly GlyphId[]): boolean {
  return left.length === right.length && left.every((glyphId, index) => glyphId === right[index]);
}

async function removeCachedAtlas(filePath: string): Promise<void> {
  try {
    await fs.promises.rm(filePath, { force: true });
  } catch {
    // Cache cleanup must never turn a disposable miss into a product failure.
  }
}

async function removeFiles(filePaths: readonly string[]): Promise<void> {
  await Promise.all(filePaths.map((filePath) => fs.promises.rm(filePath, { force: true })));
}
