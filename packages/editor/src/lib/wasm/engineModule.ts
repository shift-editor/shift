import type { FontIntent, GlyphId } from "@shift/types";
import {
  engineApply,
  engineBeginEdit,
  engineCancelEdit,
  engineDiscardRedo,
  engineEndEdit,
  engineMarkSaved,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRedo,
  engineRelease,
  engineUndo,
  type EngineEdit,
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
   * Applies `intents` within the open edit and returns every layer they
   * touched and the font-level records they changed.
   *
   * @throws When an intent is invalid or the source fails; the session is then
   * as loading left it.
   */
  apply(intents: readonly FontIntent[]): EngineEdit {
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

  /**
   * Opens an edit: the applies until {@link EngineSession.endEdit} become one
   * undo step and one change set.
   */
  beginEdit(): void {
    engineBeginEdit(this.#handle);
  }

  /**
   * Closes the open edit as one undo step.
   *
   * @returns Its change set, as named MessagePack, to persist; `undefined`
   * when it changed nothing.
   */
  endEdit(): Uint8Array | undefined {
    return engineEndEdit(this.#handle);
  }

  /** Drops the open edit; the session goes back to where it began. */
  cancelEdit(): void {
    engineCancelEdit(this.#handle);
  }

  /**
   * Takes back the latest edit.
   *
   * @returns What it did, with its change set to persist; `undefined` when
   * there is nothing to undo.
   * @throws When the inverse no longer applies; the edit stays undoable.
   */
  undo(): EngineEdit | undefined {
    return engineUndo(this.#handle);
  }

  /**
   * Makes the latest undone edit again.
   *
   * @returns As {@link EngineSession.undo}; `undefined` when there is nothing
   * to redo.
   */
  redo(): EngineEdit | undefined {
    return engineRedo(this.#handle);
  }

  /** Forgets every undone edit. */
  discardRedo(): void {
    engineDiscardRedo(this.#handle);
  }

  /**
   * Records that the font, where the history now stands, is the saved
   * document: after a save, or on opening one with no unsaved edits.
   */
  markSaved(): void {
    engineMarkSaved(this.#handle);
  }

  /** Releases the session; it applies nothing afterwards. */
  dispose(): void {
    released.unregister(this);
    engineRelease(this.#handle);
  }
}

export type { EngineEdit, EngineLayer, EngineLayerSource };
