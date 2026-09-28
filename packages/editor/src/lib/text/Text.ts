import { mintRunId, type GlyphId, type GlyphName, type RunId, type Unicode } from "@shift/types";
import { computed, keyedCache, signal, track } from "../signals";
import type { ComputedSignal, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { Font } from "../model/Font";
import type { ShiftStore } from "../store/ShiftStore";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunRecord } from "../../types/text";
import { glyphTextItem, lineBreakTextItem, Positioner, TextLayout, type TextItem } from "./layout";

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #positioner = new Positioner();
  readonly #glyphsLoadedCell = signal(0);
  readonly #loading = new Set<GlyphId>();
  readonly #runCells = new Map<RunId, WritableSignal<TextRunRecord | null>>();
  readonly #unsubscribeStore: () => void;
  readonly #layouts = keyedCache({
    name: "text.layout",
    key: (runId: RunId) => runId,
    dispose: (layoutCell: ComputedSignal<TextLayout | null>) => layoutCell.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      computed(
        () => {
          const runId = runIdCell.value;
          const record = this.#runCell(runId).value;
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
    this.#unsubscribeStore = store.onChange((change) => {
      if (change.before?.type !== "textrun" && change.after?.type !== "textrun") return;
      const runId = change.id as RunId;
      const record = change.after?.type === "textrun" ? change.after : null;
      this.#runCells.get(runId)?.set(record);
      if (record) this.#acquireGlyphs(record.items);
    });
    for (const record of store.records()) {
      if (record.type === "textrun") this.#acquireGlyphs(record.items);
    }
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

  run(id: RunId | null): TextRunRecord | null {
    if (!id) return null;
    const record = this.#store.get(id);
    return record?.type === "textrun" ? record : null;
  }

  setItems(id: RunId, items: readonly TextItem[]): void {
    const run = this.run(id);
    if (run) this.#store.put({ ...run, items: [...items] });
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
    this.#layouts.clear();
    this.#runCells.clear();
  }

  #runCell(id: RunId): WritableSignal<TextRunRecord | null> {
    let cell = this.#runCells.get(id);
    if (!cell) {
      cell = signal(this.run(id), { name: `text.run.${id}` });
      this.#runCells.set(id, cell);
    }
    return cell;
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind !== "glyph") continue;
      const glyph = this.#editor.font.recordForName(item.glyphName);
      if (glyph && !this.#editor.glyphForId(glyph.id)) this.#loadGlyph(glyph.id);
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
