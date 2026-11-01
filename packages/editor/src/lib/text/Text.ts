import { mintRunId, type GlyphId, type NodeId, type RunId, type TextItemId } from "@shift/types";
import { computed, keyedCache, signal, track, untracked } from "../signals";
import type { ComputedSignal, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunNode } from "../../types/node";
import type {
  FeatureHighlight,
  FeatureListing,
  RunPlacement,
  StoredTextRunRecord,
  SubstitutionListing,
  TextHighlight,
  TextLayoutFailure,
  TextRunRecord,
  TextRunSettings,
} from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  glyphIdForItem,
  type TextItem,
  type TextLayout,
} from "./layout";
import type {
  FontFeature,
  Direction,
  TextAlign,
  TextLayout as LaidOutText,
} from "@shift/wasm/protocol";
import { RunText } from "./RunText";
import { DEFAULT_TEXT_RUN_SETTINGS, featureValue, textRunWithDefaults } from "./runSettings";
import { GlyphNameParser, type TextParseContext, type TextParser } from "./parsing";

/** The smallest size a run node sets its text at: one scene unit to the em. */
const MIN_TEXT_SIZE = 1;
/** The smallest distance between baselines, in ems. */
const MIN_LINE_HEIGHT = 0.1;

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #glyphsLoadedCell = signal(0);
  // non-reactive: dedupes in-flight glyph loads; only read by the imperative load path
  readonly #loading = new Map<GlyphId, Promise<void>>();
  readonly #runsByItem: StoreIndex<TextItemId, StoredTextRunRecord>;
  // non-reactive: run nodes placed this session that go again if editing leaves them empty;
  // read only when editing ends.
  readonly #provisionalRuns = new Set<NodeId>();
  readonly #unsubscribeStore: () => void;
  readonly #parseContext: TextParseContext = {
    glyphNamed: (name) => {
      const entry = this.#editor.font.entryForName(name);
      return entry ? this.glyphItem(entry.id) : null;
    },
  };
  #parser: TextParser = new GlyphNameParser();
  /** The last reason text could not be shaped, so each is said once. */
  #lastUnshapable: string | null = null;
  readonly #runs = keyedCache({
    name: "text.run",
    key: (runId: RunId) => runId,
    dispose: (runText: RunText) => runText.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      // Created on a layout's first read; its shaping effect must not join that computed.
      untracked(
        () =>
          new RunText(this.#editor, runIdCell, {
            run: (id) => this.run(id),
            glyphsLoadedCell: this.#glyphsLoadedCell,
            onLaidOut: (laidOut) => this.#acquireLaidOutGlyphs(laidOut),
          }),
      ),
  });

  /**
   * The run the user is working in: the one being typed in, otherwise the
   * scene's only run, such as the page run around an edited glyph.
   *
   * @remarks
   * Null when no text is being typed and the scene holds no run or several.
   */
  readonly currentRunCell: Signal<TextRunRecord | null> = computed(
    () => {
      const node = this.currentRunNodeCell.value;
      return node ? this.run(node.runId) : null;
    },
    { name: "text.currentRun" },
  );

  /** The node that places {@link currentRunCell}'s run, whose size the Text section sets. */
  readonly currentRunNodeCell: Signal<TextRunNode | null> = computed(
    () => {
      const editing = this.#editor.textEditing.stateCell.value;
      const scene = this.#editor.scene;
      // Scene lookups read without subscribing; rerun when its nodes change.
      track(scene.cell);
      return scene.nodeOfKind(editing?.nodeId ?? null, "textRun") ?? scene.only("textRun");
    },
    { name: "text.currentRunNode" },
  );

  /**
   * The features the font's compiled feature code defines, in tag order,
   * with their names, defaults and groups, as Rust lists them.
   *
   * @remarks
   * Follows the shaper font: editing what it compiles from lists the new
   * features once it recompiles. Empty in a preview, which has no engine;
   * `failed`, with why, when the font has no shaper font or it cannot be
   * read, so a list that could not be read is never shown as empty.
   */
  readonly featuresCell: Signal<FeatureListing> = computed(
    (): FeatureListing => {
      try {
        return { kind: "listed", features: this.#editor.font.fontFeatures() };
      } catch (error) {
        return { kind: "failed", error };
      }
    },
    { name: "text.features", equals: sameListing },
  );

  /**
   * The first run whose text has no layout, or whose layout could not load
   * what it shows, with why; null while every run lays out. The editor
   * shows it, so a failed layout is never just an empty run.
   */
  readonly layoutFailureCell: ComputedSignal<TextLayoutFailure | null> = computed(
    () => {
      for (const run of this.#store.recordsOfType("textrun")) {
        const failure = this.#runs.get(run.id).failureCell.value;
        if (failure) return failure;
      }
      return null;
    },
    { name: "text.layoutFailure" },
  );

  readonly #substitutions = keyedCache({
    name: "text.featureSubstitutions",
    key: (tag: string) => tag,
    dispose: (substitutionsCell: ComputedSignal<SubstitutionListing>) =>
      substitutionsCell.dispose(),
    create: (tagCell: Signal<string>) =>
      computed(
        (): SubstitutionListing => {
          try {
            const substitutions = this.#editor.font.featureSubstitutions(tagCell.value);
            return { kind: "listed", substitutions };
          } catch (error) {
            return { kind: "failed", error };
          }
        },
        { name: "text.featureSubstitutions" },
      ),
  });

  readonly #featureHighlightCell = signal<FeatureHighlight | null>(null, {
    name: "text.featureHighlight",
  });

  /**
   * The glyphs a highlighted feature changes in its run: what it puts in the
   * text while it applies there, what it would replace while it does not.
   *
   * @remarks
   * Null while no feature is highlighted, and while its substitutions or
   * whether it applies cannot be read: the Features section and the preview
   * say why. Follows the run's setting, the font's default and the shaper
   * font, so turning the feature on or off while it is highlighted moves the
   * highlight.
   */
  readonly highlightCell: Signal<TextHighlight | null> = computed(
    () => {
      const highlight = this.#featureHighlightCell.value;
      const run = highlight ? this.run(highlight.runId) : null;
      if (!highlight || !run) return null;

      const listing = this.featureSubstitutionsCell(highlight.tag).value;
      if (listing.kind === "failed") return null;
      const setting = run.features[highlight.tag];
      const applies = this.#featureApplies(
        highlight.tag,
        setting === undefined ? null : featureValue(setting),
      );
      if (applies === null) return null;
      const glyphs = new Set(
        listing.substitutions.flatMap(({ input, output }) => (applies ? [output] : input)),
      );
      return { runId: run.id, glyphs };
    },
    { name: "text.highlight" },
  );

  constructor(store: ShiftStore<ShiftEditorRecord>, editor: Editor) {
    this.#store = store;
    this.#editor = editor;
    this.#runsByItem = store.index("textrun", (run) => run.items.map((item) => item.id));
    this.#unsubscribeStore = store.onChange((change) => {
      if (change.after?.type === "textrun") this.#acquireGlyphs(change.after.items);
    });
    for (const record of store.records()) {
      if (record.type === "textrun") this.#acquireGlyphs(record.items);
    }
  }

  /** Returns the run holding an item and the item itself, or null for an unknown id. */
  itemLocation(id: TextItemId): { readonly run: TextRunRecord; readonly item: TextItem } | null {
    const run = this.runForItem(id);
    const item = run?.items.find((candidate) => candidate.id === id);
    return run && item ? { run, item } : null;
  }

  /**
   * Returns a new item that shows a glyph in the font.
   *
   * @remarks
   * A glyph the font maps a character to becomes that character, so it takes
   * part in shaping like typed text; any other glyph is picked by identity.
   *
   * @returns null when the glyph is not in the font.
   */
  glyphItem(glyphId: GlyphId): TextItem | null {
    const font = this.#editor.font;
    const entry = font.entryForId(glyphId);
    if (!entry) return null;
    const typed = entry.unicodes.find((unicode) => font.entryForUnicode(unicode)?.id === glyphId);
    return typed === undefined ? glyphTextItem(glyphId) : characterTextItem(typed);
  }

  /**
   * Returns the glyph an item shows in its run's layout.
   *
   * @returns null for a line break, an unknown item, or a character the font maps no glyph to.
   */
  glyphIdForItem(id: TextItemId): GlyphId | null {
    const run = this.runForItem(id);
    if (!run) return null;
    return this.layout(run.id)?.placedGlyphForItem(id)?.glyph.glyphId ?? null;
  }

  /** Stores an independent proof text source. */
  createRun(items: readonly TextItem[]): TextRunRecord {
    const record: TextRunRecord = {
      id: mintRunId(),
      type: "textrun",
      scope: "document",
      items: [...items],
      ...DEFAULT_TEXT_RUN_SETTINGS,
    };
    this.#store.put(record);
    return record;
  }

  /**
   * Returns a run record.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when this run changes.
   */
  run(id: RunId | null): TextRunRecord | null {
    if (!id) return null;
    const record = this.#store.record(id);
    return record?.type === "textrun" ? textRunWithDefaults(record) : null;
  }

  /**
   * Returns the items of the run a node places.
   *
   * @remarks
   * Reactive like {@link run}. Empty when the run record is gone.
   */
  items(node: TextRunNode): readonly TextItem[] {
    return this.run(node.runId)?.items ?? [];
  }

  /**
   * Returns the run holding an item, or null for an unknown item.
   *
   * @remarks
   * Reactive: the reader reruns when the item is added to or removed from a run.
   */
  runForItem(id: TextItemId): TextRunRecord | null {
    const [stored] = this.#runsByItem.get(id);
    return stored ? textRunWithDefaults(stored) : null;
  }

  /** Replaces a run's items; the run's definition removes a child whose item went (`onContentChange`). */
  setItems(id: RunId, items: readonly TextItem[]): void {
    const run = this.run(id);
    if (run) this.#store.put({ ...run, items: [...items] });
  }

  /**
   * Turns shaping on or off for a run; off lays out each item as typed.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setShaping(id: RunId, shaping: boolean): void {
    this.#setSetting(id, "shaping", shaping);
  }

  /**
   * Turns a feature on or off for a run, or back to the font's default.
   *
   * @param on - `true` or `false` to force the feature; `null` for the default.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setFeature(id: RunId, tag: string, on: boolean | null): void {
    const run = this.run(id);
    if (!run || (run.features[tag] ?? null) === on) return;

    const { [tag]: _previous, ...rest } = run.features;
    this.#store.put({ ...run, features: on === null ? rest : { ...rest, [tag]: on } });
  }

  /**
   * Returns every feature of a run to the font's default.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  resetFeatures(id: RunId): void {
    const run = this.run(id);
    if (run && Object.keys(run.features).length > 0) this.#store.put({ ...run, features: {} });
  }

  /**
   * Sets the BCP 47 language a run is shaped as, or null for the font's default.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setLanguage(id: RunId, language: string | null): void {
    this.#setSetting(id, "language", language);
  }

  /**
   * Sets the ISO 15924 script a whole run is shaped in, or null for each
   * stretch's own.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setScript(id: RunId, script: string | null): void {
    this.#setSetting(id, "script", script);
  }

  /**
   * Sets the distance between a run's baselines in ems, at least a tenth of
   * an em, or null for the font's line spacing.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setLineHeight(id: RunId, lineHeight: number | null): void {
    this.#setSetting(
      id,
      "lineHeight",
      lineHeight === null ? null : Math.max(MIN_LINE_HEIGHT, lineHeight),
    );
  }

  /**
   * Sets the size a run node sets its text at: the scene units one em spans.
   *
   * @param size - At least one scene unit.
   *
   * @remarks
   * Writes the scene node, so call it inside a history capture.
   */
  setSize(nodeId: NodeId, size: number): void {
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    const clamped = Math.max(MIN_TEXT_SIZE, size);
    if (node && node.size !== clamped) this.#editor.scene.updateNode({ id: nodeId, size: clamped });
  }

  /**
   * Sets how a run's lines line up, or null to follow each line's direction.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setAlign(id: RunId, align: TextAlign | null): void {
    this.#setSetting(id, "align", align);
  }

  #setSetting<K extends keyof TextRunSettings>(id: RunId, key: K, value: TextRunSettings[K]): void {
    const run = this.run(id);
    if (run && run[key] !== value) this.#store.put({ ...run, [key]: value });
  }

  /**
   * Inserts items into a run directly after one of its items.
   *
   * @returns false when the run or `afterId` is missing.
   */
  insertAfter(id: RunId, afterId: TextItemId, items: readonly TextItem[]): boolean {
    const current = this.run(id)?.items;
    const index = current?.findIndex((item) => item.id === afterId) ?? -1;
    if (!current || index < 0) return false;

    this.setItems(id, [...current.slice(0, index + 1), ...items, ...current.slice(index + 1)]);
    return true;
  }

  deleteRun(id: RunId): void {
    this.#store.delete(id);
  }

  /**
   * Every substitution a feature can make, ordered by output glyph: the
   * glyphs each rule replaces and the glyph it puts in their place, as Rust
   * reads them from the shaper font's `GSUB`.
   *
   * @remarks
   * Follows edits to what the shaper font compiles from. Empty for a
   * positioning feature, a tag the font does not define, and in a preview;
   * `failed`, with why, when they cannot be read.
   */
  featureSubstitutionsCell(tag: string): ComputedSignal<SubstitutionListing> {
    return this.#substitutions.get(tag);
  }

  /**
   * Whether shaping applies a feature at `setting`, as Rust decides; null
   * when that cannot be read, which the feature listing reports
   * ({@link featuresCell}).
   */
  #featureApplies(tag: string, setting: number | null): boolean | null {
    try {
      return this.#editor.font.featureApplies(tag, setting);
    } catch {
      return null;
    }
  }

  /**
   * Highlights what a feature changes in one run's text, as
   * {@link highlightCell} describes, or clears the highlight with null.
   */
  setFeatureHighlight(highlight: FeatureHighlight | null): void {
    this.#featureHighlightCell.set(highlight);
  }

  /** The ISO 15924 scripts a run's text is laid out in, as layout itemized it, in order of first use. */
  scriptsCell(id: RunId): Signal<readonly string[]> {
    return this.#runs.get(id).scriptsCell;
  }

  /** The direction a run's first paragraph reads in, as layout resolved it; left to right for no text. */
  directionCell(id: RunId): Signal<Direction> {
    return this.#runs.get(id).directionCell;
  }

  /**
   * Places a new text run on a page: the only way a run node is made.
   *
   * @remarks
   * The run is set at the font's units per em, so its glyphs show at font
   * size. A run placed empty, to type into, is provisional: if text editing
   * leaves it with nothing typed, {@link leaveRun} removes it again. Placing is
   * not an undo step; what is typed into the run is.
   *
   * @returns the run node.
   */
  placeRun({ page, at, glyphs }: RunPlacement): TextRunNode {
    const items = glyphs.flatMap((glyphId) => this.glyphItem(glyphId) ?? []);
    const node = this.#editor.history.withoutRecording(() =>
      this.#editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        parentId: page.id,
        runId: this.createRun(items).id,
        size: this.#editor.font.metricsCell.peek().unitsPerEm,
        position: { x: at.x, y: at.y },
      }),
    );
    if (items.length === 0) this.#provisionalRuns.add(node.id);
    return node;
  }

  /**
   * Called when text editing leaves a run node: a provisional run left empty
   * is removed, without an undo step; one with text in it is kept for good.
   */
  leaveRun(nodeId: NodeId): void {
    if (!this.#provisionalRuns.delete(nodeId)) return;

    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || this.items(node).length > 0) return;

    this.#editor.history.withoutRecording(() => {
      this.#editor.scene.deleteNode(node.id);
      this.deleteRun(node.runId);
    });
  }

  /**
   * Deletes the runs that only `deleted` placed, as when their page goes.
   *
   * @param deleted - nodes already removed from the scene.
   */
  deleteRunsPlacedBy(deleted: readonly TextRunNode[]): void {
    for (const node of deleted) {
      if (this.#editor.scene.nodesReferencing(node.runId).length === 0) this.deleteRun(node.runId);
    }
  }

  /** Returns a stable computed whose layout invalidates on content, location, source, or glyph acquisition. */
  layoutCell(id: RunId): ComputedSignal<TextLayout | null> {
    return this.#runs.get(id).layoutCell;
  }

  /**
   * Why a run has no layout, or what its layout needed that did not load
   * (glyphs into the engine, or a preview's layout module); null while it
   * lays out and loads what it shows.
   */
  runLayoutFailureCell(id: RunId): Signal<TextLayoutFailure | null> {
    return this.#runs.get(id).failureCell;
  }

  /**
   * The run's layout now, without subscribing; reactive readers use {@link layoutCell}.
   *
   * @returns null when the run cannot lay out.
   */
  layout(id: RunId): TextLayout | null {
    return this.layoutCell(id).peek();
  }

  /** The parser for typed and pasted text; replace it to change the input syntax for every run. */
  get parser(): TextParser {
    return this.#parser;
  }

  set parser(parser: TextParser) {
    this.#parser = parser;
  }

  /** Parses typed, pasted, or imported text with {@link parser}. */
  itemsFromText(text: string): TextItem[] {
    return this.#parser.parse(text, this.#parseContext);
  }

  /**
   * Resolves once every glyph text needs has loaded.
   *
   * @remarks
   * Loading a glyph can reshape text and ask for more glyphs, so this waits
   * until a pass finds nothing pending.
   */
  async settled(): Promise<void> {
    for (;;) {
      const loads = this.#loading.values().toArray();
      if (loads.length === 0) return;
      await Promise.all(loads);
    }
  }

  dispose(): void {
    this.layoutFailureCell.dispose();
    this.#unsubscribeStore();
    this.#runsByItem.dispose();
    this.#runs.clear();
    this.#substitutions.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const glyphId = glyphIdForItem(item, this.#editor.font);
      if (glyphId && !this.#editor.glyphForId(glyphId)) void this.#loadGlyph(glyphId);
    }
  }

  /** Loads glyphs the shaper substituted in, which no item names directly. */
  /** Loads the glyphs a layout shows that are not loaded yet, such as ones shaping substituted in. */
  #acquireLaidOutGlyphs(laidOut: LaidOutText): void {
    if (laidOut.unshaped) this.#reportUnshapable(laidOut.unshaped);
    for (const glyph of laidOut.glyphs) {
      if (glyph.glyphId && !this.#editor.glyphForId(glyph.glyphId)) {
        void this.#loadGlyph(glyph.glyphId);
      }
    }
  }

  /** Says why text could not be shaped, once for each reason in a row. */
  #reportUnshapable(reason: string): void {
    if (reason === this.#lastUnshapable) return;
    this.#lastUnshapable = reason;
    console.warn(`text lays out unshaped: ${reason}`);
  }

  #loadGlyph(id: GlyphId): Promise<void> {
    const pending = this.#loading.get(id);
    if (pending) return pending;
    const load = this.#loadGlyphOnce(id);
    this.#loading.set(id, load);
    return load;
  }

  async #loadGlyphOnce(id: GlyphId): Promise<void> {
    try {
      await this.#editor.font.loadGlyph(id);
      this.#glyphsLoadedCell.update((version) => version + 1);
    } catch (error) {
      console.error("failed to load text glyph", error);
    } finally {
      this.#loading.delete(id);
    }
  }
}

/** Whether two listings list the same features, or are the same failure. */
function sameListing(a: FeatureListing, b: FeatureListing): boolean {
  if (a.kind === "listed" && b.kind === "listed") return sameFeatures(a.features, b.features);
  return a === b;
}

/** Whether two feature lists list the same features, every field alike, in the same order. */
function sameFeatures(a: readonly FontFeature[], b: readonly FontFeature[]): boolean {
  return a.length === b.length && a.every((feature, index) => sameFields(feature, b[index]!));
}

/** Whether two records of flat fields hold the same value in every field, whatever fields they have. */
function sameFields<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}
