import type { FontIntent, GlyphId } from "@shift/types";
import {
  engineApply,
  engineEvict,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRelease,
  type EngineLayer,
  type EngineLayerSource,
} from "@shift/wasm/engine";

const released = new FinalizationRegistry<number>(engineRelease);

/**
 * An editing session in `@shift/wasm/engine`: shift-engine over the open
 * font, applying intents synchronously, as the native workspace does.
 *
 * @remarks
 * Loaded through `loadEngine` so this module, and the engine module it
 * imports, load only when a font opens for editing. Layers load on demand
 * through the `EngineLayerSource` it opens with. The module's copy is
 * released by `dispose`, or when this object is collected.
 */
export class EngineSession {
  readonly #handle: number;

  private constructor(handle: number) {
    this.#handle = handle;
    released.register(this, handle, this);
  }

  /**
   * Opens a session over a font directory, as `LayerReader.loadDirectory`
   * returns it.
   *
   * @throws When `directory` does not decode to a font.
   */
  static open(directory: Uint8Array, source: EngineLayerSource): EngineSession {
    return new EngineSession(engineOpen(directory, source));
  }

  /**
   * Applies `intents` as one edit and returns every layer it touched, in the
   * shape of the workspace's echo.
   *
   * @throws When an intent is invalid or the source fails; the session is then
   * as loading left it.
   */
  apply(intents: readonly FontIntent[]): EngineLayer[] {
    return engineApply(this.#handle, [...intents]);
  }

  /**
   * Loads every layer of `glyphIds` and of the glyphs their components use,
   * so the edits that read them load nothing.
   *
   * @throws When a glyph is unknown or the source fails.
   */
  preload(glyphIds: readonly GlyphId[]): void {
    enginePreload(this.#handle, [...glyphIds]);
  }

  /**
   * Every layer applying `intents` would touch, as it would be, without
   * keeping the edit: a preview for a gesture under way.
   *
   * @throws As {@link EngineSession.apply}.
   */
  preview(intents: readonly FontIntent[]): EngineLayer[] {
    return enginePreview(this.#handle, [...intents]);
  }

  /** Drops the loaded layers of `glyphIds`, so the next edit reads them from the store again. */
  evict(glyphIds: readonly GlyphId[]): void {
    engineEvict(this.#handle, [...glyphIds]);
  }

  /** Releases the session; it applies nothing afterwards. */
  dispose(): void {
    released.unregister(this);
    engineRelease(this.#handle);
  }
}

export type { EngineLayer, EngineLayerSource };
