import { carryingNames } from "@shift/pack";
import type { BridgeApi } from "@shift/types";
import {
  NativeAtlas,
  NativeShaping,
  NativeSource,
  NativeWorkspace,
} from "@shift/types/native-protocol";
import { Bridge } from "shift-bridge";

// oxlint-disable-next-line eslint-js/no-restricted-syntax -- the bridge package re-exports every bridge type
export type * from "@shift/types";

export { NativeAtlas, NativeShaping, NativeSource, NativeWorkspace };

/**
 * The native workspace, as the utility process calls it.
 *
 * @remarks
 * Each area is a class generated from its Rust `#[pack::interface]` trait,
 * whose requests cross through the addon's request export for that area. What
 * the traits do not carry yet stays a napi method on {@link ShiftBridge.napi}:
 * Slug atlas streams, the async export and specimen tasks, and the reads the
 * window's engine takes over.
 */
export interface ShiftBridge {
  /** The open workspace: opening, saving and closing it, persisting edits, and its font's records. */
  readonly workspace: NativeWorkspace;
  /** Slug atlases of the open workspace or the font source, prepared for the window's GPU. */
  readonly atlas: NativeAtlas;
  /** A font file opened for browsing in the glyph catalog. */
  readonly source: NativeSource;
  /** The shaping tables the window's engine shapes text with. */
  readonly shaping: NativeShaping;
  /** The addon's remaining napi methods. */
  readonly napi: BridgeApi;
}

/**
 * A native workspace with nothing open. The addon and this side share no
 * name table, so each request carries the names it uses.
 */
export function createBridge(): ShiftBridge {
  const addon = new Bridge() as unknown as BridgeApi;
  return {
    workspace: new NativeWorkspace(
      carryingNames((method, numbers, blobs) => addon.workspaceRequest(method, numbers, blobs)),
    ),
    atlas: new NativeAtlas(
      carryingNames((method, numbers, blobs) => addon.atlasRequest(method, numbers, blobs)),
    ),
    source: new NativeSource(
      carryingNames((method, numbers, blobs) => addon.sourceRequest(method, numbers, blobs)),
    ),
    shaping: new NativeShaping(
      carryingNames((method, numbers, blobs) => addon.shapingRequest(method, numbers, blobs)),
    ),
    napi: addon,
  };
}
