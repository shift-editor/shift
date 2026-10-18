import { mintRunId, type GlyphId, type RunId, type TextItemId } from "@shift/types";
import { computed, keyedCache, signal, untracked } from "../signals";
import type { ComputedSignal, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunNode } from "../../types/node";
import type { TextAlign, TextRunRecord } from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  TextLayout,
  glyphIdForItem,
  type Direction,
  type TextItem,
} from "./layout";
import { RunText, type ShapedText } from "./RunText";
import { GlyphNameParser, type TextParseContext, type TextParser } from "./parsing";

/** Glyphs one run draws highlighted. */
export interface TextHighlight {
  readonly runId: RunId;
  readonly glyphs: ReadonlySet<GlyphId>;
}

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #glyphsLoadedCell = signal(0);
  readonly #highlightCell = signal<TextHighlight | null>(null);
  // non-reactive: dedupes in-flight glyph loads; only read by the imperative load path
  readonly #loading = new Map<GlyphId, Promise<void>>();
  readonly #runsByItem: StoreIndex<TextItemId, TextRunRecord>;
  readonly #unsubscribeStore: () => void;
  readonly #parseContext: TextParseContext = {
    glyphNamed: (name) => {
      const entry = this.#editor.font.entryForName(name);
      return entry ? this.glyphItem(entry.id) : null;
    },
  };
  #parser: TextParser = new GlyphNameParser();
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
            prepare: (shaped) => this.#loadShapedGlyphs(shaped),
          }),
      ),
  });
  readonly #scripts = keyedCache({
    name: "text.scripts",
    key: (runId: RunId) => runId,
    dispose: (scriptsCell: ComputedSignal<readonly string[]>) => scriptsCell.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      computed(
        () => {
          const shaped = this.#runs.get(runIdCell.value).shapedCell.value;
          const scripts = new Set<string>();
          for (const paragraph of shaped?.paragraphs ?? []) {
            for (const run of paragraph.shaped.runs) if (run.script) scripts.add(run.script);
          }
          return [...scripts];
        },
        { name: "text.scripts", equals: sameStrings },
      ),
  });
  readonly #directions = keyedCache({
    name: "text.direction",
    key: (runId: RunId) => runId,
    dispose: (directionCell: ComputedSignal<Direction>) => directionCell.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      computed(
        () =>
          this.#runs.get(runIdCell.value).shapedCell.value?.paragraphs[0]?.shaped.direction ??
          "ltr",
        { name: "text.direction" },
      ),
  });
  /**
   * The run node the user is working in: the one being typed in, otherwise
   * the scene's only run, such as the page run around an edited glyph.
   *
   * @remarks
   * Null when no text is being typed and the scene holds no run or several.
   */
  readonly currentRunNodeCell: Signal<TextRunNode | null> = computed(
    () => {
      const editing = this.#editor.textEditing.stateCell.value;
      // The node lookup does not subscribe; a run node keeps the same run for its whole life.
      const typedIn = this.#editor.scene.nodeOfKind(editing?.nodeId ?? null, "textRun");
      const runs = this.#editor.scene.cell.value.nodes.filter((node) => node.kind === "textRun");
      const node = typedIn ?? (runs.length === 1 ? runs[0] : null);
      return node?.kind === "textRun" ? node : null;
    },
    { name: "text.currentRunNode" },
  );
  /** The record of {@link currentRunNodeCell}'s run. */
  readonly currentRunCell: Signal<TextRunRecord | null> = computed(
    () => {
      const node = this.currentRunNodeCell.value;
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
    return this.layoutCell(run.id).peek()?.placedGlyphForItem(id)?.glyph.glyphId ?? null;
  }

  /** Stores an independent proof text source. */
  createRun(items: readonly TextItem[]): TextRunRecord {
    const record: TextRunRecord = {
      id: mintRunId(),
      type: "textrun",
      scope: "document",
      items: [...items],
      shaping: true,
      features: {},
      language: null,
      script: null,
      align: null,
      lineHeight: null,
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
    return record?.type === "textrun" ? record : null;
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
    return this.#runsByItem.get(id)[0] ?? null;
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

  /** Returns every feature of a run to the font's default. */
  resetFeatures(id: RunId): void {
    const run = this.run(id);
    if (run && Object.keys(run.features).length > 0) this.#store.put({ ...run, features: {} });
  }
  /**
   * Sets the language a run is shaped as.
   *
   * @param language - A BCP 47 tag such as `ur`; null for the font's default language.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setLanguage(id: RunId, language: string | null): void {
    const run = this.run(id);
    if (run && run.language !== language) this.#store.put({ ...run, language });
  }

  /**
   * Sets the script a run is shaped in.
   *
   * @param script - An ISO 15924 tag such as `Arab`; null to use each stretch's own script.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setScript(id: RunId, script: string | null): void {
    const run = this.run(id);
    if (run && run.script !== script) this.#store.put({ ...run, script });
  }

  /**
   * Sets how a run's lines line up; null follows each line's direction.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setAlign(id: RunId, align: TextAlign | null): void {
    const run = this.run(id);
    if (run && run.align !== align) this.#store.put({ ...run, align });
  }

  /**
   * Sets the distance between a run's baselines.
   *
   * @param lineHeight - In ems, such as 1.5; null for the font's own line spacing.
   *
   * @remarks
   * Writes the run record, so call it inside a history capture.
   */
  setLineHeight(id: RunId, lineHeight: number | null): void {
    const run = this.run(id);
    if (run && run.lineHeight !== lineHeight) this.#store.put({ ...run, lineHeight });
  }

  /**
   * Returns the scripts a run's text was shaped in, in order of first use.
   *
   * @remarks
   * Reactive, and unchanged while the scripts stay the same, so a reader
   * doesn't rerun on every keystroke. Empty until the text is shaped.
   */
  scriptsCell(id: RunId): ComputedSignal<readonly string[]> {
    return this.#scripts.get(id);
  }

  /**
   * Returns the direction of a run's first paragraph: right to left when it
   * starts with Arabic or Hebrew, say.
   *
   * @remarks
   * Reactive. Left to right until the text is shaped.
   */
  directionCell(id: RunId): ComputedSignal<Direction> {
    return this.#directions.get(id);
  }

  /**
   * The glyphs one run draws highlighted, such as those a hovered feature
   * changes; null while nothing is highlighted.
   */
  get highlightCell(): Signal<TextHighlight | null> {
    return this.#highlightCell;
  }

  /** Highlights the given glyphs wherever one run sets them, or clears the highlight. */
  setHighlight(highlight: TextHighlight | null): void {
    this.#highlightCell.set(highlight);
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

  dispose(): void {
    this.#unsubscribeStore();
    this.#runsByItem.dispose();
    this.#scripts.clear();
    this.#directions.clear();
    this.#runs.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const glyphId = glyphIdForItem(item, this.#editor.font);
      if (glyphId && !this.#editor.glyphForId(glyphId)) void this.#loadGlyph(glyphId);
    }
  }

  /** Loads the glyphs the shaper substituted in, which no item names directly. */
  async #loadShapedGlyphs(shaped: ShapedText): Promise<void> {
    const loads: Promise<void>[] = [];
    for (const paragraph of shaped.paragraphs) {
      for (const run of paragraph.shaped.runs) {
        for (const glyph of run.glyphs) {
          if (glyph.glyphId && !this.#editor.glyphForId(glyph.glyphId)) {
            loads.push(this.#loadGlyph(glyph.glyphId));
          }
        }
      }
    }
    await Promise.all(loads);
  }

  /** Loads a glyph, joining a load already under way; failures are logged, not thrown. */
  #loadGlyph(id: GlyphId): Promise<void> {
    const pending = this.#loading.get(id);
    if (pending) return pending;
    const load = (async () => {
      try {
        await this.#editor.font.loadGlyph(id);
        this.#glyphsLoadedCell.update((version) => version + 1);
      } catch (error) {
        console.error("failed to load text glyph", error);
      } finally {
        this.#loading.delete(id);
      }
    })();
    this.#loading.set(id, load);
    return load;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
