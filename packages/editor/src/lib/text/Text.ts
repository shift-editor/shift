import { mintRunId, type GlyphId, type GlyphName, type RunId, type TextItemId } from "@shift/types";
import { computed, keyedCache, signal, track, untracked } from "../signals";
import type { ComputedSignal, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunNode } from "../../types/node";
import type { TextRunRecord } from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  lineBreakTextItem,
  Positioner,
  TextLayout,
  textItemGlyph,
  type TextItem,
} from "./layout";
import { paragraphRequests, RunShaping, shapingKey, type ShapedText } from "./RunShaping";
import { locationFromExternalAxisLocation } from "../variation/location";

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
  readonly #shapings = keyedCache({
    name: "text.shaping",
    key: (runId: RunId) => runId,
    dispose: (shaping: RunShaping) => shaping.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      // Created on a layout's first read; its effect must not join that computed.
      untracked(
        () =>
          new RunShaping(
            this.#editor.font,
            computed(
              () => {
                const record = this.run(runIdCell.value);
                // A preview reads its source without a workspace, which is what shapes.
                if (!record || this.#editor.sessionMode === "preview") return null;
                // A glyph's new Unicode value can change what the text shapes to.
                track(this.#editor.font.glyphEntriesCell);
                const location = locationFromExternalAxisLocation(
                  this.#editor.externalLocationCell.value,
                );
                return {
                  key: shapingKey(record.items),
                  paragraphs: paragraphRequests(record.items, location),
                };
              },
              { name: "text.shapingRequest" },
            ),
            (shaped) => this.#acquireShapedGlyphs(shaped),
          ),
      ),
  });
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
          // Items resolve to glyphs by Unicode value and id, so remapping or deleting a glyph re-lays out.
          track(this.#editor.font.glyphEntriesCell);
          track(this.#glyphsLoadedCell);
          if (!record) return null;

          // A result shaped from other text would map glyphs to the wrong items; lay out literally until it catches up.
          const shaped = this.#shapings.get(runId).shapedCell.value;
          const current = shaped?.key === shapingKey(record.items) ? shaped : null;
          return new TextLayout({
            items: record.items,
            origin: { x: 0, y: 0 },
            editor: this.#editor,
            positioner: this.#positioner,
            externalLocation: this.#editor.externalLocationCell,
            shaped: current?.paragraphs ?? null,
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

  /**
   * Parses pasted or imported text.
   *
   * @remarks
   * `/name` picks a glyph by name; a slash alone, or one before a name the
   * font lacks, is a literal character.
   */
  itemsFromText(text: string): TextItem[] {
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
        const name = source.slice(index + 1, end) as GlyphName;
        const entry = end > index + 1 ? this.#editor.font.entryForName(name) : null;
        const picked = entry ? this.glyphItem(entry.id) : null;
        if (picked) {
          items.push(picked);
          index = end;
          continue;
        }
      }
      const codepoint = source.codePointAt(index);
      if (codepoint === undefined) break;
      items.push(characterTextItem(codepoint));
      index += String.fromCodePoint(codepoint).length;
    }
    return items;
  }

  dispose(): void {
    this.#unsubscribeStore();
    this.#runsByItem.dispose();
    this.#layouts.clear();
    this.#shapings.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const { entry } = textItemGlyph(item, this.#editor.font);
      if (entry && !this.#editor.glyphForId(entry.id)) this.#loadGlyph(entry.id);
    }
  }

  /** Loads glyphs the shaper substituted in, which no item names directly. */
  #acquireShapedGlyphs(shaped: ShapedText): void {
    for (const runs of shaped.paragraphs) {
      for (const run of runs) {
        for (const glyph of run.glyphs) {
          if (glyph.glyphId && !this.#editor.glyphForId(glyph.glyphId)) {
            void this.#loadGlyph(glyph.glyphId);
          }
        }
      }
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
