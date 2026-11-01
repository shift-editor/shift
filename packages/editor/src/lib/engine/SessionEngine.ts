import type {
  EngineFontRecords,
  FontIntent,
  GlyphId,
  GlyphName,
  LayerId,
  NodeId,
  SlugWeightSet,
  SourceId,
} from "@shift/types";
import {
  FontChangeFlagSchema,
  type FeatureSubstitution,
  type FontChangeFlag,
  type FontFeature,
  type GlyphIdentityChange,
  type PlacedText,
  type RevisedNode,
  type SceneIntent,
  type TextRun,
} from "@shift/wasm/protocol";
import { batch, signal, type Signal, type WritableSignal } from "../signals";
import {
  loadEngine,
  type EditRecording,
  type EditablePair,
  type EngineEdit,
  type EngineKerningPair,
  type EngineLayer,
  type EngineSession,
  type EngineStage,
  type InterpolatedMetrics,
  type MissingKerningOrigin,
} from "../wasm/engine";
import { unkerned } from "../model/Kerning";
import type { EngineStore } from "../../types/engine";
import type { EngineVariation, FontEngine, KerningPlace } from "../../types/font";

/** Every flag an edit's impact can set, in bit order: bit `i` is flag `i`, as Rust declares them. */
const CHANGE_FLAGS: readonly FontChangeFlag[] = FontChangeFlagSchema.names;

/** An impact that sets every flag, as opening a session does. */
const EVERY_CHANGE = (1 << CHANGE_FLAGS.length) - 1;
/** The impact of a change to glyph layers alone, as a preview makes. */
const LAYERS_CHANGE = 1 << CHANGE_FLAGS.indexOf("layers");

/**
 * shift-engine over one font, read and edited synchronously: the
 * {@link FontEngine} a font's model reads kerning, metrics, variation and
 * shaped text from, and the history its edits and undo run on.
 *
 * @remarks
 * The engine reads what it has not loaded from an {@link EngineStore}. Every
 * edit applies here, in the frame it is made, and the engine's layers are
 * what the font shows. An edit opens with {@link beginEdit} and closes with
 * {@link endEdit}, which returns the change set a store persists. Undo and
 * redo run on the engine's own history.
 *
 * There is one revision per Rust `FontChangeFlag` ({@link revision}), bumped
 * from each edit's, undo's, redo's or staged frame's impact bits, and all of
 * them whenever a session opens. The revisions and {@link variationCell}
 * outlive the session: {@link replace} opens another one in its place, and
 * readers tracking them read the new one.
 */
export class SessionEngine implements FontEngine {
  // non-reactive: one revision signal per flag, made once; the signals themselves notify
  readonly #revisions: ReadonlyMap<FontChangeFlag, WritableSignal<number>> = new Map(
    CHANGE_FLAGS.map((flag) => [flag, signal(0, { name: `sessionEngine.revision.${flag}` })]),
  );
  #session: EngineSession | null = null;
  readonly #variation: WritableSignal<EngineVariation | null> = signal<EngineVariation | null>(
    null,
    { name: "sessionEngine.variation" },
  );
  /** The impact of the open edit's changes so far, to show again when it is rewound or cancelled. */
  #inEdit = 0;

  /**
   * Opens an engine over `store`.
   *
   * @returns An open engine; the caller disposes it.
   * @throws When the engine module fails to load, or `store`'s directory or
   * scene does not decode.
   */
  static async open(store: EngineStore): Promise<SessionEngine> {
    const engine = new SessionEngine();
    await engine.replace(store);
    return engine;
  }

  revision(flag: FontChangeFlag): Signal<number> {
    const revision = this.#revisions.get(flag);
    if (!revision) throw new Error(`no revision for the change flag ${flag}`);
    return revision;
  }

  layoutInputs(): readonly FontChangeFlag[] {
    // Before a session opens, any flag: opening changes them all.
    return this.#session?.layoutInputs() ?? CHANGE_FLAGS;
  }

  shaperInputs(): readonly FontChangeFlag[] {
    return this.#session?.shaperInputs() ?? CHANGE_FLAGS;
  }

  fontFeatures(): readonly FontFeature[] | null {
    return this.#session?.fontFeatures() ?? null;
  }

  featureSubstitutions(tag: string): readonly FeatureSubstitution[] | null {
    return this.#session?.featureSubstitutions(tag) ?? null;
  }

  featureApplies(tag: string, on: boolean | null): boolean {
    return this.#session?.featureApplies(tag, on) ?? false;
  }

  get variationCell(): Signal<EngineVariation | null> {
    return this.#variation;
  }

  get isOpen(): boolean {
    return this.#session !== null;
  }

  /**
   * The open font's axes, master sources, kerning and glyph records, as the
   * engine holds them, unsaved edits included.
   *
   * @throws When no session is open.
   */
  fontRecords(): EngineFontRecords {
    return this.#require().fontRecords();
  }

  /**
   * Opens an edit: the applies until {@link endEdit} become one undo step and
   * one change set, recorded as made on `pageId`, the page the font shows.
   */
  beginEdit(pageId: NodeId | null): void {
    this.#require().beginEdit(pageId);
    this.#inEdit = 0;
  }

  /**
   * Applies scene `intents` within the open edit.
   *
   * @throws When the engine is not open, no edit is open, or an intent is refused.
   */
  applyScene(intents: readonly SceneIntent[]): EngineEdit {
    const session = this.#require();
    performance.mark("engine.applyScene.start");
    try {
      return this.#shown(session.applyScene(intents));
    } finally {
      performance.measure("engine.applyScene", "engine.applyScene.start");
    }
  }

  /**
   * Applies scene `intents` within the open edit as one frame of a gesture.
   *
   * @throws As {@link applyScene}.
   */
  stageScene(intents: readonly SceneIntent[]): EngineStage {
    const session = this.#require();
    performance.mark("engine.stageScene.start");
    try {
      const staged = session.stageScene(intents);
      this.#record(staged.impact);
      return staged;
    } finally {
      performance.measure("engine.stageScene", "engine.stageScene.start");
    }
  }

  /** Every node of the document's scene, unsaved edits included; empty before the engine opens. */
  sceneNodes(): readonly RevisedNode[] {
    return this.#session?.sceneNodes() ?? [];
  }

  /**
   * Applies `intents` within the open edit and returns every layer they
   * touched and the font-level records they changed.
   *
   * @throws When the engine is not open, no edit is open, an intent is
   * invalid, or a read fails.
   */
  apply(intents: readonly FontIntent[]): EngineEdit {
    const session = this.#require();
    performance.mark("engine.apply.start");
    try {
      return this.#shown(session.apply(intents));
    } finally {
      performance.measure("engine.apply", "engine.apply.start");
    }
  }

  /**
   * Puts the engine back where the open edit began, keeping the edit open,
   * so what is applied next replaces what it applied so far.
   *
   * @throws When the engine is not open or no edit is open.
   */
  rewindEdit(): void {
    this.#require().rewindEdit();
    this.#showEditUndone();
  }

  /**
   * Applies `intents` within the open edit without building the font-level
   * records they change: one frame of a gesture, whose records are built when
   * it commits.
   *
   * @returns The layers they touched and which reads they changed.
   * @throws As {@link apply}.
   */
  stage(intents: readonly FontIntent[]): EngineStage {
    const session = this.#require();
    performance.mark("engine.stage.start");
    try {
      const staged = session.stage(intents);
      this.#record(staged.impact);
      return staged;
    } finally {
      performance.measure("engine.stage", "engine.stage.start");
    }
  }

  /**
   * Every layer applying `intents` would touch, as it would be, without
   * keeping the edit: a gesture's preview, one call per changed frame.
   *
   * @throws As {@link apply}.
   */
  preview(intents: readonly FontIntent[]): EngineLayer[] {
    const session = this.#require();
    performance.mark("engine.preview.start");
    try {
      const layers = session.preview(intents);
      // Text lays out from the previewed font while the gesture shows it.
      this.#changed(LAYERS_CHANGE);
      return layers;
    } finally {
      performance.measure("engine.preview", "engine.preview.start");
    }
  }

  /**
   * Lays text out from what `intents` would leave, without keeping them or
   * returning layers: one call per drag frame the editor draws itself.
   */
  showPreview(intents: readonly FontIntent[]): void {
    const session = this.#require();
    performance.mark("engine.showPreview.start");
    try {
      session.showPreview(intents);
      this.#changed(LAYERS_CHANGE);
    } finally {
      performance.measure("engine.showPreview", "engine.showPreview.start");
    }
  }

  endPreview(): void {
    const session = this.#session;
    if (!session) return;
    session.endPreview();
    this.#changed(LAYERS_CHANGE);
  }

  /**
   * Closes the open edit as one undo step.
   *
   * @returns Its change set, as named MessagePack, to persist; `undefined`
   * when it changed nothing.
   */
  endEdit(recording: EditRecording = "undoable"): Uint8Array | undefined {
    const changeSet = this.#require().endEdit(recording);
    this.#inEdit = 0;
    return changeSet;
  }

  /** Drops the open edit; the engine goes back to where it began. */
  cancelEdit(): void {
    this.#require().cancelEdit();
    this.#showEditUndone();
  }

  /**
   * Takes back the latest edit.
   *
   * @returns What it did, with its change set to persist; `undefined` when
   * there is nothing to undo.
   */
  undo(): EngineEdit | undefined {
    const undone = this.#require().undo();
    return undone && this.#shown(undone);
  }

  /** Makes the latest undone edit again; `undefined` when there is nothing to redo. */
  redo(): EngineEdit | undefined {
    const redone = this.#require().redo();
    return redone && this.#shown(redone);
  }

  kerningRun(pairs: readonly GlyphId[], place: KerningPlace): readonly number[] {
    const session = this.#session;
    if (!session) return unkerned(pairs);
    return session.kerningRun(pairs, place);
  }

  kerningPairs(sourceId: SourceId, pairs: readonly GlyphId[]): readonly EditablePair[] {
    return this.#session?.kerningPairs(sourceId, pairs) ?? [];
  }

  kerningPairsNaming(sourceId: SourceId, glyphId: GlyphId): EngineKerningPair[] {
    return this.#session?.kerningPairsNaming(sourceId, glyphId) ?? [];
  }

  missingKerningOrigin(sourceId: SourceId): MissingKerningOrigin {
    return this.#session?.missingKerningOrigin(sourceId) ?? "unkerned";
  }

  sourceMetricsAt(location: readonly number[]): InterpolatedMetrics | null {
    return this.#session?.sourceMetricsAt(location) ?? null;
  }

  atlasWeights(
    sets: readonly SlugWeightSet[],
    weightCount: number,
    external: readonly number[],
  ): readonly number[] | null {
    return this.#session?.atlasWeights(sets, weightCount, external) ?? null;
  }

  glyphRename(glyphId: GlyphId, name: string): GlyphIdentityChange | null {
    return this.#require().glyphRename(glyphId, name);
  }

  glyphPrimaryCodepoint(glyphId: GlyphId, codepoint: number | null): GlyphIdentityChange | null {
    return this.#require().glyphPrimaryCodepoint(glyphId, codepoint);
  }

  nextGlyphName(name: string): GlyphName {
    return this.#require().nextGlyphName(name);
  }

  layoutText(run: TextRun, place: KerningPlace): PlacedText | null {
    return this.#session?.layoutText(run, place) ?? null;
  }

  /**
   * Loads the layers of glyphs a layout showed unloaded, as an edit would,
   * then tells layout readers, which lay the text out again from them.
   *
   * @throws When the store's reader cannot answer; nothing is told then.
   */
  preload(glyphIds: readonly GlyphId[]): void {
    const session = this.#session;
    if (!session || glyphIds.length === 0) return;
    session.preload(glyphIds);
    this.#changed(LAYERS_CHANGE);
  }

  newAnchorName(layerIds: readonly LayerId[]): string {
    return this.#require().newAnchorName(layerIds);
  }

  /** Forgets every undone edit. */
  discardRedo(): void {
    this.#require().discardRedo();
  }

  /** Records that the font, where the history now stands, is the saved document. */
  markSaved(): void {
    this.#require().markSaved();
  }

  /**
   * Loads what editing `glyphIds` reads when the window is idle, so the first
   * edit loads nothing. A failure is only logged: the edit loads it again.
   */
  preloadWhenIdle(glyphIds: readonly GlyphId[]): void {
    if (glyphIds.length === 0) return;
    const preload = () => {
      const session = this.#session;
      if (!session) return;
      performance.mark("engine.preload.start");
      try {
        session.preload(glyphIds);
      } catch (error) {
        console.warn("engine preload failed", error);
      } finally {
        performance.measure("engine.preload", "engine.preload.start");
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(preload);
    else setTimeout(preload, 0);
  }

  /** Closes the open session, if any; reads then answer as before an open. */
  dispose(): void {
    this.close();
  }

  /**
   * Opens a session over `store` in place of the open one, which closes, and
   * tells every reader: each revision changes and {@link variationCell} takes
   * the new session.
   *
   * @remarks
   * The old session closes and the new one shows in one batch, so readers
   * rerun once, against the new session. When opening fails, the open
   * session stays.
   *
   * @throws As {@link SessionEngine.open}.
   */
  protected async replace(store: EngineStore): Promise<void> {
    const { EngineSession } = await loadEngine();
    const session = EngineSession.open(store.directory, store.request, store.scene);
    batch(() => {
      this.close();
      this.#session = session;
      this.#variation.set(session);
      this.#changed(EVERY_CHANGE);
    });
  }

  /**
   * Closes the open session, if any. A subclass that holds the session's
   * store extends this to release it.
   */
  protected close(): void {
    if (!this.#session) return;
    this.#session.dispose();
    this.#session = null;
    this.#variation.set(null);
  }

  /** `edit`, after telling readers which of the engine's reads it changed. */
  #shown(edit: EngineEdit): EngineEdit {
    this.#record(edit.impact);
    return edit;
  }

  /** Tells readers that what the open edit changed is gone, as after a rewind or cancel. */
  #showEditUndone(): void {
    const changed = this.#inEdit;
    this.#inEdit = 0;
    this.#changed(changed);
  }

  /** Records a change's impact within the open edit, if one is open, and tells readers. */
  #record(impact: number): void {
    this.#inEdit |= impact;
    this.#changed(impact);
  }

  /** Bumps the revision of each flag `impact` sets. */
  #changed(impact: number): void {
    batch(() => {
      CHANGE_FLAGS.forEach((flag, bit) => {
        if ((impact & (1 << bit)) === 0) return;
        this.#revisions.get(flag)?.update((revision) => revision + 1);
      });
    });
  }

  #require(): EngineSession {
    if (!this.#session) throw new Error("the editing engine is not open");
    return this.#session;
  }
}
