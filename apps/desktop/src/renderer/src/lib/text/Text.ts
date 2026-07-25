import { mintRunId, type GlyphName, type RunId, type Unicode } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { ShiftStore } from "@/lib/store/ShiftStore";
import type { ShiftEditorRecord, TextRunRecord } from "@/types";
import type { TextRunNode } from "@/types/node";
import { glyphTextItem, lineBreakTextItem, Positioner, TextLayout, type TextItem } from "./layout";

/**
 * Owns document-scoped text run records.
 *
 * @remarks
 * Text run records store proof text source. Scene nodes place that source on
 * the canvas; layout, caret state, and glyph editing projections are layered
 * above this record surface.
 */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #positioner = new Positioner();

  constructor(store: ShiftStore<ShiftEditorRecord>, editor: Editor) {
    this.#store = store;
    this.#editor = editor;
  }

  /**
   * Creates text source content independent from scene placement.
   *
   * @param text - raw proof string, including slash-name escapes.
   * @returns the stored text run record.
   */
  createRun(text: string): TextRunRecord {
    const record: TextRunRecord = {
      id: mintRunId(),
      type: "textrun",
      scope: "document",
      text,
    };

    this.#store.put(record);

    return record;
  }

  /**
   * Resolves text source content by identity.
   *
   * @param runId - text run identity referenced by a placed text run node.
   * @returns the stored text run record, or null when the run is absent.
   */
  run(runId: RunId | null): TextRunRecord | null {
    if (!runId) return null;

    const record = this.#store.get(runId);
    if (record?.type !== "textrun") return null;

    return record;
  }

  /**
   * Builds node-local layout for a placed text run.
   *
   * @param node - scene placement that addresses text source content.
   * @returns null when the run is absent or contains no layout items.
   */
  layoutForNode(node: TextRunNode): TextLayout | null {
    const run = this.run(node.runId);
    if (!run) return null;

    const items = itemsForText(run.text, this.#editor.font);
    if (items.length === 0) return null;

    return new TextLayout({
      items,
      origin: { x: 0, y: 0 },
      editor: this.#editor,
      positioner: this.#positioner,
      designLocation: this.#editor.designLocationCell,
    });
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
      const [name, end] = slashGlyphName(source, index + 1);
      if (name !== "") {
        const handle = font.glyphHandleForName(name as GlyphName);
        items.push(glyphTextItem(handle.name, handle.unicode ?? null));
        index = end;
        continue;
      }
    }

    const codepoint = source.codePointAt(index);
    if (codepoint === undefined) continue;

    const unicode = codepoint as Unicode;
    const handle = font.glyphHandleForUnicode(unicode);
    items.push(glyphTextItem(handle.name, handle.unicode ?? unicode));
    index += String.fromCodePoint(codepoint).length;
  }

  return items;
}

function slashGlyphName(text: string, start: number): readonly [string, number] {
  let end = start;

  while (end < text.length) {
    const char = text[end];
    if (!char || char === "/" || /\s/.test(char)) break;

    end += 1;
  }

  return [text.slice(start, end), end];
}
