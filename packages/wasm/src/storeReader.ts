/**
 * shift-engine's `StoreReader` asked from TypeScript, for tests and test hooks
 * that read the store the way the engine does. The engine itself encodes its
 * requests in Rust, and the window only passes them on.
 */
import { carryingNames, type Reply } from "@shift/pack";
import { StoreReader } from "./generated-protocol";

/**
 * A `StoreReader` over `request`, a function that sends one encoded request
 * to the native store reader, such as the preload's `layers.request` bound to
 * a reader. The ids each message names travel with it, since this side and the
 * reader share no name table.
 */
export function storeReader(
  request: (method: number, numbers: Float64Array, blobs: readonly Uint8Array[]) => Reply,
): StoreReader {
  return new StoreReader(carryingNames(request));
}

export type { StoreReader, StoreReadError } from "./generated-protocol";
