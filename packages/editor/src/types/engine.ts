import type { StoreRequest } from "../lib/wasm/engine";

/**
 * Where a {@link SessionEngine}'s session reads what it has not loaded.
 *
 * @remarks
 * - `reader`: a store answered across the JS boundary, one `StoreRequest` at
 *   a time: the window's read-only reader of a `.shift` document or working
 *   store, or of a previewed UFO, Glyphs or designspace file. `directory` is
 *   the font without its layers, as the engine opens it.
 * - `resident`: a whole font, every layer loaded, as named MessagePack: a
 *   memory session, which has nothing to read and persists nothing.
 * - `compiled`: a compiled font's header (its axes, axis mappings and
 *   sources, no glyphs, and each glyph's id in glyph order) and its file
 *   (`binary`), as the utility reads them for a TrueType or OpenType
 *   preview. Its glyphs, with the compiled deltas they carry, come from the
 *   utility; the engine maps its locations, evaluates those deltas, and
 *   shapes text with the binary itself: its `cmap`, advances and every
 *   lookup it ships.
 *
 * `scene` is the document's scene nodes as the store holds them; with no
 * scene the session's scene is empty.
 */
export type EngineStore =
  | {
      readonly kind: "reader";
      readonly directory: Uint8Array;
      readonly request: StoreRequest;
      readonly scene?: Uint8Array;
    }
  | { readonly kind: "resident"; readonly font: Uint8Array; readonly scene?: Uint8Array }
  | { readonly kind: "compiled"; readonly header: Uint8Array; readonly binary: Uint8Array };
