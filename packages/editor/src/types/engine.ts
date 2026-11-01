import type { StoreRequest } from "../lib/wasm/engine";

/**
 * Where a {@link SessionEngine}'s session reads what it has not loaded.
 *
 * @remarks
 * `reader` is a store answered across the JS boundary, one `StoreRequest` at
 * a time: the window's read-only reader of a `.shift` document or working
 * store. `directory` is the font without its layers, as the engine opens it,
 * and `scene` the document's scene nodes as the store holds them; with no
 * scene the session's scene is empty.
 */
export type EngineStore = {
  readonly kind: "reader";
  readonly directory: Uint8Array;
  readonly request: StoreRequest;
  readonly scene?: Uint8Array;
};
