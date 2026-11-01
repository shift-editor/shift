import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { FontStoreLocation } from "@shared/workspace/lanes";
import type {
  EngineFontRecords,
  FontIntent,
  GlyphId,
  GlyphName,
  LayerId,
  SlugWeightSet,
  SourceId,
} from "@shift/types";
import {
  loadEngine,
  type EditablePair,
  type EngineEdit,
  type EngineKerningPair,
  type EngineLayer,
  type EngineSession,
  type EngineStage,
  type InterpolatedMetrics,
  type MissingKerningOrigin,
  unkerned,
} from "@shift/editor/model";
import {
  FontChangeFlagSchema,
  type FontChangeFlag,
  type FontFeature,
  type GlyphIdentityChange,
  type LayoutRequest,
  type PlacedText,
} from "@shift/wasm/protocol";
import { batch, signal, type Signal, type WritableSignal } from "@shift/editor/signals";
import type { EngineVariation, FontEngine, KerningPlace } from "@shift/editor/types";
import { engineStoreRequest } from "./engineStoreRequest";

/** Every flag an edit's impact can set, in bit order: bit `i` is flag `i`, as Rust declares them. */
const CHANGE_FLAGS: readonly FontChangeFlag[] = FontChangeFlagSchema.names;

/** An impact that sets every flag, as opening a session does. */
const EVERY_CHANGE = (1 << CHANGE_FLAGS.length) - 1;
/** The impact of a change to glyph layers alone, as a preview makes. */
const LAYERS_CHANGE = 1 << CHANGE_FLAGS.indexOf("layers");

/**
 * The open session and the reader it loads layers through, which moves with
 * the store. `reader` is null while released, and reopens on the next read.
 */
interface Opened {
  readonly session: EngineSession;
  reader: number | null;
  location: FontStoreLocation;
}

/** Where a {@link WindowEngine} opens from: the workspace serving this window. */
export interface EngineWorkspace {
  /** The workspace's store, for the window's layer reader; `null` for a preview. */
  storeLocation(): Promise<FontStoreLocation | null>;
  /** The font's directory as the engine opens it; `null` for a preview. */
  directory(): Promise<Uint8Array | null>;
}

/**
 * The window's editing engine: shift-engine over the workspace's font store,
 * reading layers synchronously through the window's read-only reader.
 *
 * @remarks
 * Every edit the window makes applies here, in the frame it is made, and the
 * engine's layers are what the window shows. An edit opens with
 * {@link beginEdit} and closes with {@link endEdit}, which returns the change
 * set the native workspace persists. Undo and redo run here too, on the
 * engine's own history. {@link reopen} starts over from the store, dropping
 * that history: only after a persist failed.
 *
 * The window reads kerning, interpolated metrics and shaped text from here
 * too, as the {@link FontEngine}. There is one revision per Rust
 * `FontChangeFlag` ({@link revision}), bumped from each edit's, undo's,
 * redo's or staged frame's impact bits, and all of them on every open.
 */
export class WindowEngine implements FontEngine {
  readonly #layers: LayerReaderHost;
  readonly #workspace: EngineWorkspace;
  // non-reactive: one revision signal per flag, made once; the signals themselves notify
  readonly #revisions: ReadonlyMap<FontChangeFlag, WritableSignal<number>> = new Map(
    CHANGE_FLAGS.map((flag) => [flag, signal(0, { name: `windowEngine.revision.${flag}` })]),
  );
  #opened: Opened | null = null;
  readonly #variation: WritableSignal<EngineVariation | null> = signal<EngineVariation | null>(
    null,
    { name: "windowEngine.variation" },
  );
  /** The impact of the open edit's changes so far, to show again when it is rewound or cancelled. */
  #inEdit = 0;

  constructor(layers: LayerReaderHost, workspace: EngineWorkspace) {
    this.#layers = layers;
    this.#workspace = workspace;
  }

  revision(flag: FontChangeFlag): Signal<number> {
    const revision = this.#revisions.get(flag);
    if (!revision) throw new Error(`no revision for the change flag ${flag}`);
    return revision;
  }

  layoutInputs(): readonly FontChangeFlag[] {
    // Before a session opens, any flag: opening changes them all.
    return this.#opened?.session.layoutInputs() ?? CHANGE_FLAGS;
  }

  shaperInputs(): readonly FontChangeFlag[] {
    return this.#opened?.session.shaperInputs() ?? CHANGE_FLAGS;
  }

  fontFeatures(): readonly FontFeature[] | null {
    return this.#opened?.session.fontFeatures() ?? null;
  }

  get variationCell(): Signal<EngineVariation | null> {
    return this.#variation;
  }

  get isOpen(): boolean {
    return this.#opened !== null;
  }

  /**
   * Opens the engine over the workspace's store as it stands, replacing any
   * session already open.
   *
   * @throws When the workspace has no store to read, as in a preview.
   */
  async reopen(): Promise<void> {
    const [location, directory] = await Promise.all([
      this.#workspace.storeLocation(),
      this.#workspace.directory(),
    ]);
    if (!location || !directory) throw new Error("the workspace has no font store to edit");
    const { EngineSession } = await loadEngine();

    const reader = this.#layers.open(location);
    try {
      // The session reads layers only while an edit runs, after this open, so
      // its source can follow the current reader.
      const session = EngineSession.open(
        directory,
        engineStoreRequest(this.#layers, () => this.#reader()),
      );
      batch(() => {
        this.#close();
        this.#opened = { session, reader, location };
        this.#variation.set(session);
        this.#changed(EVERY_CHANGE);
      });
    } catch (error) {
      this.#layers.close(reader);
      throw error;
    }
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
   * Reads from the workspace's store where it now lives, as after Save As. The
   * session and its history stay: the font is the same, only its file moved.
   */
  async followStore(): Promise<void> {
    const opened = this.#opened;
    const location = await this.#workspace.storeLocation();
    if (!opened || !location || FontStoreLocation.equals(location, opened.location)) return;

    const previous = opened.reader;
    opened.reader = this.#layers.open(location);
    opened.location = location;
    if (previous !== null) this.#layers.close(previous);
  }

  /**
   * Closes the reader, keeping the session, so the workspace can delete the
   * store's files: Windows refuses while they are open. The next read reopens it.
   */
  releaseStore(): void {
    const opened = this.#opened;
    if (!opened || opened.reader === null) return;
    this.#layers.close(opened.reader);
    opened.reader = null;
  }

  /** Opens an edit: the applies until {@link endEdit} become one undo step and one change set. */
  beginEdit(): void {
    this.#require().beginEdit();
    this.#inEdit = 0;
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
    const session = this.#opened?.session;
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
  endEdit(): Uint8Array | undefined {
    const changeSet = this.#require().endEdit();
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
    const session = this.#opened?.session;
    if (!session) return unkerned(pairs);
    return session.kerningRun(pairs, place);
  }

  kerningPairs(sourceId: SourceId, pairs: readonly GlyphId[]): readonly EditablePair[] {
    return this.#opened?.session.kerningPairs(sourceId, pairs) ?? [];
  }

  kerningPairsNaming(sourceId: SourceId, glyphId: GlyphId): EngineKerningPair[] {
    return this.#opened?.session.kerningPairsNaming(sourceId, glyphId) ?? [];
  }

  missingKerningOrigin(sourceId: SourceId): MissingKerningOrigin {
    return this.#opened?.session.missingKerningOrigin(sourceId) ?? "unkerned";
  }

  sourceMetricsAt(location: readonly number[]): InterpolatedMetrics | null {
    return this.#opened?.session.sourceMetricsAt(location) ?? null;
  }

  atlasWeights(
    sets: readonly SlugWeightSet[],
    weightCount: number,
    external: readonly number[],
  ): readonly number[] | null {
    return this.#opened?.session.atlasWeights(sets, weightCount, external) ?? null;
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

  layoutText(text: LayoutRequest, place: KerningPlace): PlacedText | null {
    return this.#opened?.session.layoutText(text, place) ?? null;
  }

  /**
   * Loads the layers of glyphs a layout showed unloaded, as an edit would,
   * then tells layout readers, which lay the text out again from them.
   *
   * @throws When the store's reader cannot answer; nothing is told then.
   */
  preload(glyphIds: readonly GlyphId[]): void {
    const session = this.#opened?.session;
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
      const session = this.#opened?.session;
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

  dispose(): void {
    this.#close();
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
    return this.#requireOpened().session;
  }

  #requireOpened(): Opened {
    if (!this.#opened) throw new Error("the window's editing engine is not open");
    return this.#opened;
  }

  #reader(): number {
    const opened = this.#requireOpened();
    opened.reader ??= this.#layers.open(opened.location);
    return opened.reader;
  }

  #close(): void {
    if (!this.#opened) return;
    this.#opened.session.dispose();
    this.releaseStore();
    this.#opened = null;
    this.#variation.set(null);
  }
}
