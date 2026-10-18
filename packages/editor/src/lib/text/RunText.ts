import type { ParagraphRequest, RunId, ShapedParagraph, ShapeUnit } from "@shift/types";
import { computed, effect, signal, track } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import { SerialRequest } from "../utils/SerialRequest";
import { locationFromExternalAxisLocation } from "../variation/location";
import { splitParagraphs, TextLayout, type Paragraph, type ParagraphItem } from "./layout";

/** One paragraph as last shaped, with the content it was shaped from. */
export interface KeyedParagraph {
  /** The shaped content, as {@link paragraphKey} gives it. */
  readonly key: string;
  /** Its direction and runs in logical order; clusters index the paragraph's items. */
  readonly shaped: ShapedParagraph;
}

/** A run's paragraphs as last shaped. */
export interface ShapedText {
  readonly paragraphs: readonly KeyedParagraph[];
}

/** What a run asks the shaper for: one request and content key per paragraph. */
interface ShapingRequest {
  readonly keys: readonly string[];
  readonly paragraphs: readonly ParagraphRequest[];
}

/** What a run's text reads from the {@link Text} that owns it. */
export interface RunTextOwner {
  /** Reactive like `Text.run`. */
  run(id: RunId): TextRunRecord | null;
  /** Bumped when a glyph the text shows finishes loading. */
  readonly glyphsLoadedCell: Signal<number>;
  /** Called with each shaping result, such as to load the glyphs it substituted in. */
  onShaped(shaped: ShapedText): void;
}

/**
 * Keeps one run's text shaped and laid out.
 *
 * @remarks
 * Shaping runs in the workspace process, so results arrive asynchronously,
 * one request at a time. Each paragraph uses a result only while it matches
 * that paragraph's current text, and lays out literally until then, so an
 * edit drops only the line it changed to literal layout while its new result
 * is on the way. A run with shaping off lays out literally throughout.
 * Construct outside any reactive reader: the shaping effect starts at once.
 */
export class RunText {
  readonly #keysCell: ComputedSignal<readonly string[] | null>;
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: WritableSignal<ShapedText | null> = signal(null);
  readonly #currentShapedCell: ComputedSignal<readonly (ShapedParagraph | null)[] | null>;
  readonly #shaping: SerialRequest<ShapingRequest, ShapedParagraph[]>;
  readonly #requests: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
    this.#keysCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        return record?.shaping ? splitParagraphs(record.items).map(paragraphKey) : null;
      },
      { name: "text.shapingKeys", equals: sameKeys },
    );

    this.#requestCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        const keys = this.#keysCell.value;
        // A preview reads its source without a workspace, which is what shapes.
        if (!record || keys === null || editor.sessionMode === "preview") return null;
        // A glyph's new Unicode value can change what the text shapes to.
        track(editor.font.glyphEntriesCell);
        const location = locationFromExternalAxisLocation(editor.externalLocationCell.value);
        const paragraphs = splitParagraphs(record.items).map((paragraph) => ({
          units: paragraph.items.map(shapeUnit),
          location,
        }));
        return paragraphs.length > 0 ? { keys, paragraphs } : null;
      },
      { name: "text.shapingRequest" },
    );

    this.#currentShapedCell = computed(
      () => {
        const keys = this.#keysCell.value;
        if (keys === null) return null;
        // A paragraph shaped from other text would map glyphs to the wrong items.
        const byKey = new Map(
          this.#shapedCell.value?.paragraphs.map((paragraph) => [paragraph.key, paragraph.shaped]),
        );
        return keys.map((key) => byKey.get(key) ?? null);
      },
      { name: "text.currentShaped" },
    );

    this.#shaping = new SerialRequest(
      (request: ShapingRequest) => editor.font.shapeParagraphs(request.paragraphs),
      (request, results) => {
        const paragraphs = results.map((shaped, index) => ({ key: request.keys[index]!, shaped }));
        const shaped = { paragraphs };
        this.#shapedCell.set(shaped);
        owner.onShaped(shaped);
      },
      (error) => console.error("failed to shape text", error),
    );

    this.#requests = effect(
      () => {
        const request = this.#requestCell.value;
        if (request) this.#shaping.request(request);
      },
      { name: "text.runShaping" },
    );

    this.#layoutCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        track(editor.externalLocationCell);
        track(editor.activeSourceIdCell);
        // Items resolve to glyphs by Unicode value and id, so remapping or deleting a glyph re-lays out.
        track(editor.font.glyphEntriesCell);
        track(owner.glyphsLoadedCell);
        if (!record) return null;
        return new TextLayout({
          items: record.items,
          origin: { x: 0, y: 0 },
          editor,
          externalLocation: editor.externalLocationCell,
          shaped: this.#currentShapedCell.value,
        });
      },
      { name: "text.layoutForRun" },
    );
  }

  /** The run's layout; invalidates on content, location, source, glyph loads, shaping results, and the shaping switch. */
  get layoutCell(): ComputedSignal<TextLayout | null> {
    return this.#layoutCell;
  }

  dispose(): void {
    this.#shaping.dispose();
    this.#requests.dispose();
    this.#layoutCell.dispose();
    this.#currentShapedCell.dispose();
    this.#requestCell.dispose();
    this.#keysCell.dispose();
  }
}

/**
 * Returns a key for the text a paragraph shapes: its characters and picked glyphs.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 */
function paragraphKey(paragraph: Paragraph): string {
  return paragraph.items
    .map((item) => (item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`))
    .join(" ");
}

function sameKeys(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function shapeUnit(item: ParagraphItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}
