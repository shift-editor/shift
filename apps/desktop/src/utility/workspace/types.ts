import type { GlyphId, SlugAtlas } from "@shift/types";
import type { FileHandle } from "node:fs/promises";
import type { ByteReadableStream, WorkspacePackageIdentity } from "../../shared/workspace/protocol";

/** Opaque key for one authored revision's disposable Slug pages. */
export type CachedAtlasKey = {
  documentKey: string;
  revisionKey: string;
};

/** Slug metadata persisted without a process-local prepared generation. */
export type CachedSlugAtlas = Omit<SlugAtlas, "generation">;

/** One independently compressed fixed root page in a published CachedAtlas. */
export type CachedAtlasPage = {
  pageIndex: number;
  glyphIds: GlyphId[];
  atlas: CachedSlugAtlas;
  compressedOffset: number;
  compressedLength: number;
  decodedLength: number;
  checksum: string;
};

/** One complete, indexed disposable atlas revision. */
export type CachedAtlas = CachedAtlasKey & {
  format: "shift.slug-atlas-cache.v2";
  bandCount: number;
  alignment: number;
  pageCount: number;
  pages: CachedAtlasPage[];
};

/** One native page that has finished compression into staging storage. */
export type StagedCachedAtlasPage = {
  pageIndex: number;
  glyphIds: GlyphId[];
  atlas: CachedSlugAtlas;
  filePath: string;
  compressedLength: number;
  decodedLength: number;
  checksum: string;
};

/** Writable compression boundary for one native page stream. */
export type CachedAtlasPageSink = {
  write(bytes: Uint8Array): Promise<void>;
  complete(): Promise<StagedCachedAtlasPage>;
  discard(): Promise<void>;
};

/** Fixed-page request metadata shared by visible and background builds. */
export type CachedAtlasPageRequest = {
  key: CachedAtlasKey;
  alignment: number;
  pageIndex: number;
  pageCount: number;
  glyphIds: readonly GlyphId[];
  replacementPageIndices: readonly number[];
};

/** Inputs required to publish a complete latest document entry. */
export type CachedAtlasPublication = {
  key: CachedAtlasKey;
  alignment: number;
  pageCount: number;
  replacementPageIndices: readonly number[];
  stagedPages: ReadonlyMap<number, StagedCachedAtlasPage>;
};

/** In-progress page set for one authored revision. */
export type CachedAtlasBuild = CachedAtlasPublication & {
  stagedPages: Map<number, StagedCachedAtlasPage>;
};

/** Native prepared page awaiting its renderer stream and cache staging. */
export type PreparedAtlasPage = {
  request: CachedAtlasPageRequest;
  descriptor: SlugAtlas;
};

/** Published file candidate considered by the global LRU. */
export type CachedAtlasFile = {
  filePath: string;
  name: string;
  bytes: number;
  touched: number;
};

/** One validated cache artifact whose index and file stay open across page loads. */
export type OpenedCachedAtlas = {
  atlas: CachedAtlas;
  filePath: string;
  file: FileHandle;
  payloadOffset: number;
};

/** Validated cached page ready for bounded decompression. */
export type OpenedCachedAtlasPage = {
  atlas: CachedSlugAtlas;
  stream: ByteReadableStream<Uint8Array>;
};

/** Identifies one utility-owned SQLite document allocation. */
export type DocumentAllocation = {
  documentId: string;
  storePath: string;
};

/**
 * Identifies one package instance by package id and canonical source path.
 *
 * @remarks
 * Package addresses intentionally ignore source fingerprints. They identify the
 * durable binding slot; fingerprint comparisons belong to package open actions.
 */
export class PackageAddress {
  readonly packageId: string;
  readonly canonicalPath: string;

  /**
   * Creates a package address from durable package identity fields.
   *
   * @param packageId - stable id stored in the `.shift` manifest.
   * @param canonicalPath - canonical source path for this package instance.
   */
  constructor(packageId: string, canonicalPath: string) {
    this.packageId = packageId;
    this.canonicalPath = canonicalPath;
  }

  /**
   * Builds a package address from an inspected package identity.
   *
   * @param identity - package identity returned by Rust for the current source path.
   * @returns package id and canonical path; the source fingerprint is excluded.
   */
  static fromIdentity(identity: WorkspacePackageIdentity): PackageAddress {
    return new PackageAddress(identity.packageId, identity.canonicalPath);
  }

  /**
   * Compares package addresses by durable package id and canonical source path.
   *
   * @param left - first package address.
   * @param right - second package address.
   * @returns true when both addresses identify the same package path.
   */
  static equals(left: PackageAddress, right: PackageAddress): boolean {
    return left.packageId === right.packageId && left.canonicalPath === right.canonicalPath;
  }
}

/** Binds one package instance to its current working document. */
export type PackageBinding = PackageAddress &
  DocumentAllocation & {
    updatedAt: string;
  };

/** Records a dirty working document detached from its package binding. */
export type OrphanedDocument = DocumentAllocation & {
  packageId: string;
  canonicalPath: string;
  reason: string;
  orphanedAt: string;
};

/** Describes the package-open action chosen before mutating bindings. */
export type PackageOpenAction =
  | { kind: "hydrate" }
  | { kind: "resume"; binding: PackageBinding }
  | { kind: "replace"; binding: PackageBinding }
  | { kind: "orphan"; binding: PackageBinding }
  | { kind: "move"; binding: PackageBinding };

/** Document and package address settled by a package open. */
export type PackageOpenResult = {
  document: DocumentAllocation;
  address: PackageAddress;
};
