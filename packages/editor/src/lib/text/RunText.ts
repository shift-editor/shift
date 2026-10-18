import type { ParagraphRequest, RunId, ShapedRun, ShapeUnit } from "@shift/types";
import { computed, effect, signal, track } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import { SerialRequest } from "../utils/SerialRequest";
import { locationFromExternalAxisLocation } from "../variation/location";
import { splitParagraphs, TextLayout, type ParagraphItem, type TextItem } from "./layout";

/** A run's paragraphs as last shaped, with the content they were shaped from. */
export interface ShapedText {
  /** The shaped content, as {@link shapingKey} gives it. */
  readonly key: string;
  /** Each paragraph's runs in logical order, indexed like `splitParagraphs`. */
  readonly paragraphs: readonly (readonly ShapedRun[])[];
}

interface ShapingRequest {
  readonly key: string;
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
 * one request at a time. The layout uses a result only while it matches the
 * run's current text, and lays the text out literally until then. Construct
 * outside any reactive reader: the shaping effect starts at once.
 */
export class RunText {
  readonly #keyCell: ComputedSignal<string | null>;
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: WritableSignal<ShapedText | null> = signal(null);
  readonly #currentShapedCell: ComputedSignal<ShapedText["paragraphs"] | null>;
  readonly #shaping: SerialRequest<ShapingRequest, ShapedRun[][]>;
  readonly #requests: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
    this.#keyCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        return record ? shapingKey(record.items) : null;
      },
      { name: "text.shapingKey" },
    );

    this.#requestCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        const key = this.#keyCell.value;
        // A preview reads its source without a workspace, which is what shapes.
        if (!record || key === null || editor.sessionMode === "preview") return null;
        // A glyph's new Unicode value can change what the text shapes to.
        track(editor.font.glyphEntriesCell);
        const location = locationFromExternalAxisLocation(editor.externalLocationCell.value);
        const paragraphs = splitParagraphs(record.items).map((paragraph) => ({
          units: paragraph.items.map(shapeUnit),
          location,
        }));
        return paragraphs.length > 0 ? { key, paragraphs } : null;
      },
      { name: "text.shapingRequest" },
    );

    this.#currentShapedCell = computed(
      () => {
        const shaped = this.#shapedCell.value;
        // A result shaped from other text would map glyphs to the wrong items.
        return shaped && shaped.key === this.#keyCell.value ? shaped.paragraphs : null;
      },
      { name: "text.currentShaped" },
    );

    this.#shaping = new SerialRequest(
      (request: ShapingRequest) => editor.font.shapeParagraphs(request.paragraphs),
      (request, paragraphs) => {
        const shaped = { key: request.key, paragraphs };
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

  /** The run's layout; invalidates on content, location, source, glyph loads, and shaping results. */
  get layoutCell(): ComputedSignal<TextLayout | null> {
    return this.#layoutCell;
  }

  dispose(): void {
    this.#shaping.dispose();
    this.#requests.dispose();
    this.#layoutCell.dispose();
    this.#currentShapedCell.dispose();
    this.#requestCell.dispose();
    this.#keyCell.dispose();
  }
}

/**
 * Returns a key for the text a run shapes: its characters and picked glyphs,
 * by paragraph.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 */
function shapingKey(items: readonly TextItem[]): string {
  return items
    .map((item) => {
      if (item.kind === "linebreak") return "\n";
      return item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`;
    })
    .join(" ");
}

function shapeUnit(item: ParagraphItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}
