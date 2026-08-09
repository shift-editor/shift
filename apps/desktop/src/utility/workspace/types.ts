import type { GlyphId, SlugAtlas } from "@shift/types";
import type { FileHandle } from "node:fs/promises";
import type {
  ByteReadableStream,
  WorkspaceDocumentIdentity,
} from "../../shared/workspace/protocol";

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
  format: "shift.slug-atlas-cache.v1";
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

/** App-owned paths for one live or recoverable authored workspace. */
export type WorkspaceAllocation = {
  workspaceId: string;
  storePath: string;
  recoveryPath: string;
};

/** Stable canonical document identity plus its exact canonical filesystem path. */
export class DocumentAddress {
  readonly documentId: string;
  readonly canonicalPath: string;

  constructor(documentId: string, canonicalPath: string) {
    this.documentId = documentId;
    this.canonicalPath = canonicalPath;
  }

  static fromIdentity(identity: WorkspaceDocumentIdentity): DocumentAddress {
    return new DocumentAddress(identity.documentId, identity.canonicalPath);
  }

  static equals(left: DocumentAddress, right: DocumentAddress): boolean {
    return left.documentId === right.documentId && left.canonicalPath === right.canonicalPath;
  }
}

/** Binds one canonical document address to its app-owned recovery allocation. */
export type DocumentBinding = DocumentAddress &
  WorkspaceAllocation & {
    updatedAt: string;
  };

/** Workspace allocation and canonical address settled by native document Open. */
export type DocumentOpenResult = {
  workspace: WorkspaceAllocation;
  address: DocumentAddress;
};
