import {
  mintRunId,
  type GlyphId,
  type GlyphName,
  type RunId,
  type TextItemId,
  type Unicode,
} from "@shift/types";
import { computed, keyedCache, signal, track } from "../signals";
import type { ComputedSignal, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { Font } from "../model/Font";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunRecord } from "../../types/text";
import { glyphTextItem, lineBreakTextItem, Positioner, TextLayout, type TextItem } from "./layout";

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #positioner = new Positioner();
  readonly #glyphsLoadedCell = signal(0);
  // non-reactive: dedupes in-flight glyph loads; only read by the imperative load path
  readonly #loading = new Set<GlyphId>();
  readonly #runsByItem: StoreIndex<TextItemId, TextRunRecord>;
  readonly #unsubscribeStore: () => void;
  readonly #layouts = keyedCache({
    name: "text.layout",
    key: (runId: RunId) => runId,
    dispose: (layoutCell: ComputedSignal<TextLayout | null>) => layoutCell.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      computed(
        () => {
          const runId = runIdCell.value;
          const record = this.run(runId);
          track(this.#editor.externalLocationCell);
          track(this.#editor.activeSourceIdCell);
          track(this.#glyphsLoadedCell);
          if (!record) return null;

          return new TextLayout({
            items: record.items,
            origin: { x: 0, y: 0 },
            editor: this.#editor,
            positioner: this.#positioner,
            externalLocation: this.#editor.externalLocationCell,
          });
        },
        { name: "text.layoutForRun" },
      ),
  });
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
   * Returns a new glyph item for a glyph in the font.
   *
   * @returns null when the glyph is not in the font.
   */
  glyphItem(glyphId: GlyphId): TextItem | null {
    const entry = this.#editor.font.entryForId(glyphId);
    return entry ? glyphTextItem(entry.name, entry.unicodes[0] ?? null) : null;
  }

  /** Stores an independent proof text source. */
  createRun(items: readonly TextItem[]): TextRunRecord {
    const record: TextRunRecord = {
      id: mintRunId(),
      type: "textrun",
      scope: "document",
      items: [...items],
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
    return this.#layouts.get(id);
  }

  /** Parses pasted or imported text; typing a slash alone is a literal character. */
  itemsFromText(text: string): TextItem[] {
    return itemsForText(text, this.#editor.font);
  }

  dispose(): void {
    this.#unsubscribeStore();
    this.#runsByItem.dispose();
    this.#layouts.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind !== "glyph") continue;
      const entry = this.#editor.font.entryForName(item.glyphName as GlyphName);
      if (entry && !this.#editor.glyphForId(entry.id)) this.#loadGlyph(entry.id);
    }
  }

  async #loadGlyph(id: GlyphId): Promise<void> {
    if (this.#loading.has(id)) return;
    this.#loading.add(id);
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

function itemsForText(text: string, font: Font): TextItem[] {
  const items: TextItem[] = [];
  const source = text.replaceAll("\r\n", "\n");
  for (let index = 0; index < source.length; ) {
    const char = source[index];
    if (char === "\n") {
      items.push(lineBreakTextItem());
      index += 1;
      continue;
    }
    if (char === "/") {
      let end = index + 1;
      while (end < source.length && source[end] !== "/" && !/\s/.test(source[end]!)) end++;
      if (end > index + 1) {
        const name = source.slice(index + 1, end);
        const handle = font.glyphHandleForName(name as GlyphName);
        items.push(glyphTextItem(handle.name, handle.unicode ?? null));
        index = end;
        continue;
      }
    }
    const codepoint = source.codePointAt(index);
    if (codepoint === undefined) break;
    const handle = font.glyphHandleForUnicode(codepoint as Unicode);
    items.push(glyphTextItem(handle.name, handle.unicode ?? codepoint));
    index += String.fromCodePoint(codepoint).length;
  }
  return items;
}
