import type { FontIntent, GlyphId, GlyphName, LayerId, SourceId } from "@shift/types";
import {
  engineApply,
  engineBeginEdit,
  engineCancelEdit,
  engineDiscardRedo,
  engineEndEdit,
  engineGlyphNumbers,
  engineMarkSaved,
  engineNewAnchorName,
  engineNextGlyphName,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRedo,
  engineRelease,
  engineRewindEdit,
  engineSourceNumbers,
  engineStage,
  engineUndo,
  type EngineEdit,
  type EngineLayer,
  type EngineLayerSource,
  type EngineStage,
} from "@shift/wasm/engine";
import {
  engineKerningPairs,
  engineKerningRun,
  engineSourceMetricsAt,
  type EditablePair,
  type InterpolatedMetrics,
} from "./generated/engineLayouts";

export { svgPathContours, type ContourPoints } from "./generated/engineLayouts";
import type { KerningPlace } from "../../types/font";
import { unkerned } from "../model/Kerning";

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
  // non-reactive: numbers the session interned for each id; an id's number never changes
  readonly #glyphNumbers = new Map<GlyphId, number>();
  // non-reactive: as #glyphNumbers, for sources
  readonly #sourceNumbers = new Map<SourceId, number>();

  private constructor(handle: number) {
    this.#handle = handle;
    released.register(this, handle, this);
  }

  /**
   * Opens a session over a font directory, as the workspace's `encodedDirectory`
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
   * Puts the session back where the open edit began, keeping the edit open,
   * so the applies that follow replace what it applied so far.
   *
   * @throws When no edit is open.
   */
  rewindEdit(): void {
    engineRewindEdit(this.#handle);
  }

  /**
   * Applies `intents` within the open edit, as {@link EngineSession.apply}
   * does, without building the font-level records it changed: one frame of a
   * gesture, whose records are built once when it commits.
   *
   * @returns The layers they touched and which reads they changed.
   * @throws As {@link EngineSession.apply}.
   */
  stage(intents: readonly FontIntent[]): EngineStage {
    return engineStage(this.#handle, [...intents]);
  }

  /**
   * Reads the kerning between glyph pairs at one place in the session's font.
   *
   * @param pairs - Each pair's first glyph then its second.
   * @returns One value per pair in font units; zeros when the place cannot be read.
   */
  kerningRun(pairs: readonly GlyphId[], place: KerningPlace): readonly number[] {
    const glyphs = this.#numbers(pairs, this.#glyphNumbers, engineGlyphNumbers);
    const source =
      place.kind === "source"
        ? this.#numbers([place.sourceId], this.#sourceNumbers, engineSourceNumbers)[0]
        : null;
    const location = place.kind === "location" ? place.location : [];
    const values = engineKerningRun({ engine: this.#handle, source, location, glyphs });
    return values ?? unkerned(pairs);
  }

  /**
   * Reads, for each glyph pair, the authored pair an edit to it at `sourceId`
   * changes in the session's font, and whether it applies there.
   *
   * @param pairs - Each pair's first glyph then its second.
   */
  kerningPairs(sourceId: SourceId, pairs: readonly GlyphId[]): readonly EditablePair[] {
    const [source] = this.#numbers([sourceId], this.#sourceNumbers, engineSourceNumbers);
    const glyphs = this.#numbers(pairs, this.#glyphNumbers, engineGlyphNumbers);
    return engineKerningPairs({ engine: this.#handle, source: source ?? 0, glyphs });
  }

  /**
   * Interpolates the session's font's source metrics at a design location.
   *
   * @param location - Design coordinates in the font's axis order, NaN for an axis default.
   * @returns null when the font's masters do not interpolate, as for a static font.
   */
  sourceMetricsAt(location: readonly number[]): InterpolatedMetrics | null {
    return engineSourceMetricsAt({ engine: this.#handle, location });
  }

  /**
   * The name a new glyph asked to be called `name` takes in the session's
   * font: `name` trimmed, or `newGlyph` when blank, numbered `.1`, `.2`, …
   * past any glyph already called that.
   */
  nextGlyphName(name: string): GlyphName {
    return engineNextGlyphName(this.#handle, name) as GlyphName;
  }

  /**
   * The name a new anchor added to every one of `layerIds` takes: `new`,
   * numbered `.1`, `.2`, … past any anchor already called that in any of them.
   */
  newAnchorName(layerIds: readonly LayerId[]): string {
    return engineNewAnchorName(this.#handle, [...layerIds]);
  }

  /** Each of `ids` by the number the session interned it as, interning new ones in one call. */
  #numbers<Id extends string>(
    ids: readonly Id[],
    numbers: Map<Id, number>,
    intern: (handle: number, ids: string[]) => Uint32Array,
  ): number[] {
    const missing = [...new Set(ids.filter((id) => !numbers.has(id)))];
    if (missing.length > 0) {
      const interned = intern(this.#handle, missing);
      for (const [index, id] of missing.entries()) numbers.set(id, interned[index]!);
    }
    return ids.map((id) => numbers.get(id)!);
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

export type {
  EditablePair,
  EngineEdit,
  EngineLayer,
  EngineLayerSource,
  EngineStage,
  InterpolatedMetrics,
};
