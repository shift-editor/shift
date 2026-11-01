import { mintRunId, type GlyphId, type RunId, type TextItemId } from "@shift/types";
import { computed, keyedCache, signal, track, untracked } from "../signals";
import type { ComputedSignal, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunNode } from "../../types/node";
import type { StoredTextRunRecord, TextLayoutFailure, TextRunRecord } from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  glyphIdForItem,
  type TextItem,
  type TextLayout,
} from "./layout";
import type { TextLayout as LaidOutText } from "@shift/wasm/protocol";
import { RunText } from "./RunText";
import { DEFAULT_TEXT_RUN_SETTINGS, textRunWithDefaults } from "./runSettings";
import { GlyphNameParser, type TextParseContext, type TextParser } from "./parsing";

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #glyphsLoadedCell = signal(0);
  // non-reactive: dedupes in-flight glyph loads; only read by the imperative load path
  readonly #loading = new Map<GlyphId, Promise<void>>();
  readonly #runsByItem: StoreIndex<TextItemId, StoredTextRunRecord>;
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
      const editing = this.#editor.textEditing.stateCell.value;
      const scene = this.#editor.scene;
      // Scene lookups read without subscribing; rerun when its nodes change.
      track(scene.cell);
      const node = scene.nodeOfKind(editing?.nodeId ?? null, "textRun") ?? scene.only("textRun");
      return node ? this.run(node.runId) : null;
    },
    { name: "text.currentRun" },
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
    const run = this.run(id);
    if (run && run.shaping !== shaping) this.#store.put({ ...run, shaping });
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

  /** Returns a stable computed whose layout invalidates on content, location, source, or glyph acquisition. */
  layoutCell(id: RunId): ComputedSignal<TextLayout | null> {
    return this.#runs.get(id).layoutCell;
  }

  /**
   * Why a run has no layout, or what its layout needed that did not load
   * (glyphs into the engine, or a preview's layout module); null while it
   * lays out and loads what it shows.
   */
  layoutFailureCell(id: RunId): Signal<TextLayoutFailure | null> {
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
    this.#unsubscribeStore();
    this.#runsByItem.dispose();
    this.#runs.clear();
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
