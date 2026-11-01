import type {
  EngineFontRecords,
  EngineStorelessRecords,
  FontIntent,
  FontReplacement,
  GlyphId,
  GlyphName,
  KerningGroupId,
  KerningSide,
  LayerId,
  NodeId,
  SlugWeightSet,
  SourceId,
} from "@shift/types";
import {
  engineApply,
  engineBeginEdit,
  engineCancelEdit,
  engineDiscardRedo,
  engineEndEdit,
  engineGlyphNumbers,
  engineEdits,
  engineMarkSaved,
  engineNewAnchorName,
  engineNextGlyphName,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRedo,
  engineRelease,
  engineReads,
  engineRewindEdit,
  engineSourceNumbers,
  engineSourceSetNumber,
  engineStage,
  engineUndo,
  type EngineEditLayers,
  type EngineLayer,
  type StoreRequest,
  type StoreReply,
  type EngineStage,
} from "@shift/wasm/engine";
import type {
  EditLocation,
  EditablePair,
  EngineEdits,
  EngineReads,
  GlyphIdentityChange,
  InterpolatedMetrics,
  MissingKerningOrigin,
  FontChangeFlag,
  ParagraphRequest,
  RevisedNode,
  SceneIntent,
  ShapedParagraph,
  SourceSetWeights,
} from "@shift/wasm/protocol";

export { svgPaths } from "@shift/wasm/engine";
export type { ContourPoints } from "@shift/wasm/protocol";
import type { KerningPlace } from "../../types/font";
import { unkerned } from "../model/Kerning";

const released = new FinalizationRegistry<number>(engineRelease);

/** An authored kerning pair, its sides by id, and its value at a source. */
export interface EngineKerningPair {
  readonly first: GlyphId | KerningGroupId;
  readonly second: GlyphId | KerningGroupId;
  /** Font units added after the first glyph's advance. */
  readonly amount: number;
}

/**
 * What one edit did: the layers it touched, and each font-level collection it
 * changed, whole, as the workspace's echo carries it (`next`, absent when it
 * changed none), with the records of the glyphs it changed as they now stand.
 */
export type EngineEdit = EngineEditLayers & {
  readonly next?: FontReplacement;
  /** For an undo or redo: where the edit it replayed was made, and what it changed. */
  readonly location?: EditLocation;
};

/** Whether a closed edit becomes an undo step, as shift-engine's `Recording` says. */
export type EditRecording = "undoable" | "unrecorded";

/**
 * An editing session in `@shift/wasm/engine`: shift-engine over the open
 * font, applying intents synchronously, as the native workspace does.
 *
 * @remarks
 * Loaded through `loadEngine` so this module, and the engine module it
 * imports, load only when a font opens for editing. Layers load on demand
 * from the store, through the `StoreRequest` it opens with. The module's copy is
 * released by `dispose`, or when this object is collected.
 */
export class EngineSession {
  readonly #handle: number;
  readonly #reads: EngineReads;
  readonly #intents: EngineEdits;
  // non-reactive: numbers the session interned for each id; an id's number never changes
  readonly #glyphNumbers = new Map<GlyphId, number>();
  // non-reactive: as #glyphNumbers, for sources
  readonly #sourceNumbers = new Map<SourceId, number>();
  // non-reactive: as #glyphNumbers, for ordered source sets, keyed by their joined ids
  readonly #sourceSetNumbers = new Map<string, number>();
  // non-reactive: each atlas's weight set numbers, keyed by the atlas's own sets array
  readonly #weightSetNumbers = new WeakMap<readonly SlugWeightSet[], number[]>();

  private constructor(handle: number) {
    this.#handle = handle;
    this.#reads = engineReads(handle);
    this.#intents = engineEdits(handle);
    released.register(this, handle, this);
  }

  /**
   * Opens a session over a font directory, as the workspace's `encodedDirectory`
   * returns it, and the document's scene, as the store's `sceneNodes` returns
   * it; with no scene the session's scene is empty, for reading the font's
   * records alone.
   *
   * @throws When `directory` does not decode to a font, or `scene` to scene nodes.
   */
  static open(directory: Uint8Array, source: StoreRequest, scene?: Uint8Array): EngineSession {
    return new EngineSession(engineOpen(directory, source, scene));
  }

  /**
   * Applies `intents` within the open edit and returns every layer they
   * touched and the font-level records they changed.
   *
   * @throws When an intent is invalid or the source fails; the session is then
   * as loading left it.
   */
  apply(intents: readonly FontIntent[]): EngineEdit {
    this.#intents.hold(intents);
    return this.#withReplacement(engineApply(this.#handle));
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
    this.#intents.hold(intents);
    return enginePreview(this.#handle);
  }

  /**
   * Opens an edit: the applies until {@link EngineSession.endEdit} become one
   * undo step and one change set.
   *
   * @param pageId - The page the editor shows, which the undo step records as
   * where the edit was made; null with no page shown.
   */
  beginEdit(pageId: NodeId | null): void {
    engineBeginEdit(this.#handle, pageId ?? undefined);
  }

  /**
   * Applies scene `intents` within the open edit, after any font intents held
   * with them, and returns what the edit did.
   *
   * @throws When an intent is refused; the scene is then unchanged.
   */
  applyScene(intents: readonly SceneIntent[]): EngineEdit {
    this.#intents.holdScene(intents);
    return this.#withReplacement(engineApply(this.#handle));
  }

  /**
   * Applies scene `intents` within the open edit as one frame of a gesture,
   * as {@link EngineSession.stage} does for font intents.
   *
   * @throws As {@link EngineSession.applyScene}.
   */
  stageScene(intents: readonly SceneIntent[]): EngineStage {
    this.#intents.holdScene(intents);
    return engineStage(this.#handle);
  }

  /**
   * Every node of the document's scene, each parent before its children,
   * siblings in order, with when it last changed.
   */
  sceneNodes(): readonly RevisedNode[] {
    return this.#reads.sceneNodes();
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
    this.#intents.hold(intents);
    return engineStage(this.#handle);
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
    const values = this.#reads.kerningRun(source ?? null, location, glyphs);
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
    return this.#reads.kerningPairs(source ?? 0, glyphs);
  }

  /**
   * The pairs authored at `sourceId` in the session's font that name
   * `glyphId` on a side, directly or through its group at that side.
   */
  kerningPairsNaming(sourceId: SourceId, glyphId: GlyphId): EngineKerningPair[] {
    const [source] = this.#numbers([sourceId], this.#sourceNumbers, engineSourceNumbers);
    const [glyph] = this.#numbers([glyphId], this.#glyphNumbers, engineGlyphNumbers);
    return this.#reads.kerningPairsNaming(source!, glyph!).map(({ pair, value }) => ({
      first: sideId(pair.first),
      second: sideId(pair.second),
      amount: value,
    }));
  }

  /** What renaming a glyph to `name` does, as shift-font's `Font::glyph_rename` decides. */
  glyphRename(glyphId: GlyphId, name: string): GlyphIdentityChange | null {
    return this.#reads.glyphRename(glyphId, name);
  }

  /** What making `codepoint` a glyph's primary codepoint does: `Font::glyph_primary_codepoint`. */
  glyphPrimaryCodepoint(glyphId: GlyphId, codepoint: number | null): GlyphIdentityChange | null {
    return this.#reads.glyphPrimaryCodepoint(glyphId, codepoint);
  }

  /** Where a pair's value comes from at `sourceId` when that source authors no pair for it. */
  missingKerningOrigin(sourceId: SourceId): MissingKerningOrigin {
    const [source] = this.#numbers([sourceId], this.#sourceNumbers, engineSourceNumbers);
    return this.#reads.missingKerningOrigin(source!);
  }

  /**
   * The number the session interned the ordered source set `sourceIds` as,
   * interning it when new; a set's number stays its own for the session's life.
   */
  sourceSetNumber(sourceIds: readonly SourceId[]): number {
    const key = sourceIds.join("\u0000");
    let set = this.#sourceSetNumbers.get(key);
    if (set === undefined) {
      set = engineSourceSetNumber(this.#handle, [...sourceIds]);
      this.#sourceSetNumbers.set(key, set);
    }
    return set;
  }

  /**
   * Every interned source set's weights at a design location, from the basis
   * the session's font gives each set: set `n`'s weights are
   * `weights[starts[n]]` up to `weights[starts[n + 1]]`, NaN for a set whose
   * sources the font lacks or form no model.
   *
   * @param location - Design coordinates in the font's axis order, NaN for an axis default.
   */
  sourceSetWeights(location: readonly number[]): SourceSetWeights {
    return this.#reads.sourceSetWeights(location);
  }

  /**
   * A Slug atlas's weights at an external location, from the bases the
   * session's font gives its weight sets: weight 0 is 1, and each set's
   * weights sit at its `sourceWeightIndices`.
   *
   * @remarks
   * Each `sets` array is interned once, so a frame sends only the sets'
   * numbers and the location: pass the atlas's same array every frame.
   *
   * @param external - External coordinates in the font's axis order, NaN for an axis default.
   * @returns null when a set's sources are missing from the font or form no
   * model, or a set names an index past `weightCount`.
   */
  atlasWeights(
    sets: readonly SlugWeightSet[],
    weightCount: number,
    external: readonly number[],
  ): readonly number[] | null {
    let numbers = this.#weightSetNumbers.get(sets);
    if (!numbers) {
      numbers = sets.map((set) => this.sourceSetNumber(set.basis.sourceIds));
      this.#weightSetNumbers.set(sets, numbers);
    }
    const values = this.#reads.atlasWeights(numbers, external);
    if (!values) return null;

    return placeAtlasWeights(sets, weightCount, values);
  }

  /**
   * An external location's design location, through the session's font's
   * axis mappings, both as numbers in the font's axis order, NaN for an axis
   * the location omits.
   */
  designLocation(external: readonly number[]): readonly number[] {
    return this.#reads.designLocation(external);
  }

  /**
   * The external location a design location's mapping came from, both as
   * numbers in the font's axis order; NaN on internal axes.
   */
  externalLocation(design: readonly number[]): readonly number[] {
    return this.#reads.externalLocation(design);
  }

  /**
   * Interpolates the session's font's source metrics at a design location.
   *
   * @param location - Design coordinates in the font's axis order, NaN for an axis default.
   * @returns null when the font's masters do not interpolate, as for a static font.
   */
  sourceMetricsAt(location: readonly number[]): InterpolatedMetrics | null {
    return this.#reads.sourceMetricsAt(location);
  }

  /**
   * The session's font's axes, master sources, kerning and glyph records,
   * unsaved edits included.
   *
   * @throws When the store's reader cannot answer for the glyph records.
   */
  fontRecords(): EngineFontRecords {
    return { ...this.storelessRecords(), glyphs: this.#reads.glyphRecords() };
  }

  /**
   * Shapes paragraphs with the font's feature code, through the shaper font
   * the session compiles from its own font, unsaved edits included. Compiles
   * when text is first shaped and after an edit that may change what the
   * compile reads; loads no layers.
   *
   * @returns Each paragraph's runs in logical order, in request order, or
   * why it could not be shaped: the store's reader could not answer, the
   * font cannot make a shaper font, or the paragraph cannot be shaped.
   */
  shapeParagraphs(paragraphs: readonly ParagraphRequest[]): readonly ShapedParagraph[] {
    return this.#reads.shapeParagraphs(paragraphs);
  }

  /** The change flags whose change may change what {@link shapeParagraphs} returns. */
  shapingInputs(): readonly FontChangeFlag[] {
    return this.#reads.shapingInputs();
  }

  /**
   * The session's font's axes, master sources and kerning, unsaved edits
   * included: the records it reads without asking its store.
   */
  storelessRecords(): EngineStorelessRecords {
    return {
      axes: this.#reads.axes(),
      sources: this.#reads.sources(),
      kerning: this.#reads.kerning(),
    };
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
   * Closes the open edit, as one undo step unless `recording` is
   * `"unrecorded"`.
   *
   * @returns Its document change set, font and scene, as named MessagePack, to
   * persist; `undefined` when it changed nothing.
   */
  endEdit(recording: EditRecording = "undoable"): Uint8Array | undefined {
    return engineEndEdit(this.#handle, recording);
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
    return this.#withLocation(this.#withReplacement(engineUndo(this.#handle)));
  }

  /**
   * Makes the latest undone edit again.
   *
   * @returns As {@link EngineSession.undo}; `undefined` when there is nothing
   * to redo.
   */
  redo(): EngineEdit | undefined {
    return this.#withLocation(this.#withReplacement(engineRedo(this.#handle)));
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

  /** `edit` with the font-level records it changed, which cross packed beside it. */
  #withReplacement<E extends EngineEditLayers | undefined>(edit: E): E & EngineEdit {
    const next = edit && this.#intents.replacement();
    return next ? { ...edit, next } : (edit as E & EngineEdit);
  }

  /** An undo or redo with where its edit was made, which crosses packed beside it. */
  #withLocation(edit: EngineEdit | undefined): EngineEdit | undefined {
    const location = edit && this.#intents.replayedLocation();
    return location ? { ...edit, location } : edit;
  }

  /** Releases the session; it applies nothing afterwards. */
  dispose(): void {
    released.unregister(this);
    engineRelease(this.#handle);
  }
}

/**
 * Places each set's weights, read one set after another, at its atlas
 * indices, with weight 0 at 1; null when a set names an index past
 * `weightCount` or `values` does not hold one weight per set source.
 */
function placeAtlasWeights(
  sets: readonly SlugWeightSet[],
  weightCount: number,
  values: readonly number[],
): number[] | null {
  const weights = Array.from({ length: weightCount }, (_, index): number => (index === 0 ? 1 : 0));
  let next = 0;
  for (const set of sets) {
    for (const index of set.sourceWeightIndices) {
      if (index >= weightCount || next >= values.length) return null;
      weights[index] = values[next]!;
      next += 1;
    }
  }

  return next === values.length ? weights : null;
}

/** A kerning side by its id: a glyph's or a group's. */
function sideId(side: KerningSide): GlyphId | KerningGroupId {
  return side.kind === "glyph" ? side.glyph : side.group;
}

export type {
  EditablePair,
  EngineLayer,
  StoreRequest,
  StoreReply,
  EngineStage,
  InterpolatedMetrics,
  MissingKerningOrigin,
  SourceSetWeights,
};
