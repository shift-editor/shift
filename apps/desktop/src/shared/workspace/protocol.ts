import type { WorkspaceDocumentState } from "@shift/types";
import type { SlugAtlasOrigin } from "./lanes";

/** Bounded byte delivery over a dedicated transferred port. */
export type ByteStreamMessage =
  | { kind: "chunk"; offset: number; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "complete"; totalLength: number }
  | { kind: "error"; message: string };

/** Receiver backpressure for a dedicated bounded byte stream. */
export type ByteStreamControl =
  | { kind: "ack"; nextOffset: number }
  | { kind: "cancel"; message: string };

/** Minimal readable-stream contract shared by native and web streams. */
export type ByteReadableStream<T> =
  | { getReader(): ByteReadableStreamReader<T> }
  | ReadableStream<T>;

export interface ByteReadableStreamReader<T> {
  read(): Promise<{ done: false; value: T } | { done: true; value: undefined }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

/**
 * Shell-lane calls that carry a transferred port, served beside
 * `WorkspaceShell`.
 *
 * @remarks
 * The port arrives in the handler's context, not in the payload.
 */
export type ShellPortCallMap = {
  /** Hands the window's sync-lane port to the workspace; replaces the previous sync lane. */
  connect: { request: void; response: void };
};

/** One-way shell-lane events from the workspace to main. */
export type ShellEventMap = {
  ready: void;
  "document.changed": WorkspaceDocumentState | null;
};

/**
 * Sync-lane calls that stream bytes over a transferred response port, served
 * beside `WorkspaceSync`.
 *
 * @remarks
 * Each resolves once the stream completes; the bytes travel on the port as
 * {@link ByteStreamMessage}s. Their prepare and discard calls are interface
 * methods.
 */
export type SyncStreamCallMap = {
  /** Streams one prepared preview page (from `prepareSourceAtlasPage`). */
  streamSourceAtlasPage: {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared atlas generation (from `prepareSlugAtlas`). */
  streamSlugAtlas: {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared page (from `prepareSlugAtlasPage`). */
  streamSlugAtlasPage: {
    request: { generation: number; origin: SlugAtlasOrigin; maximumLength: number };
    response: null;
  };
};

/** One-way sync-lane events from the workspace to the window. */
export type SyncEventMap = {
  "document.changed": WorkspaceDocumentState | null;
};
