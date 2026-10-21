import type { ParagraphRequest, RunId, ShapedRun, ShapeUnit } from "@shift/types";
import { computed, effect, track } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import type { RegisteredShaper } from "../wasm/shaping";
import { locationFromExternalAxisLocation } from "../variation/location";
import { splitParagraphs, TextLayout, type ParagraphItem, type TextItem } from "./layout";

/** A run's paragraphs as last shaped, with the content they were shaped from. */
export interface ShapedText {
  /** The shaped content, as {@link shapingKey} gives it. */
  readonly key: string;
  /**
   * Each paragraph's runs in logical order, indexed like `splitParagraphs`;
   * null for a paragraph that could not be shaped, which lays out literally.
   */
  readonly paragraphs: readonly (readonly ShapedRun[] | null)[];
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
  /** The shaper to shape with; null until it is ready, when text lays out literally. */
  readonly shaperCell: Signal<RegisteredShaper | null>;
  /** Called with each shaping result, such as to load the glyphs it substituted in. */
  onShaped(shaped: ShapedText): void;
}

/**
 * Keeps one run's text shaped and laid out.
 *
 * @remarks
 * Shaping runs synchronously in `@shift/wasm/shaping`, so the layout is
 * shaped as soon as the text changes. Until the owner's shaper is ready the
 * text lays out literally. Construct outside any reactive reader: the effect
 * that reports shaping results starts at once.
 */
export class RunText {
  readonly #keyCell: ComputedSignal<string | null>;
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: ComputedSignal<ShapedText | null>;
  readonly #reports: Effect;
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

    this.#shapedCell = computed(
      () => {
        const request = this.#requestCell.value;
        const shaper = owner.shaperCell.value;
        if (!request || !shaper) return null;
        return { key: request.key, paragraphs: shaper.shapeParagraphs(request.paragraphs) };
      },
      { name: "text.shaped" },
    );

    this.#reports = effect(
      () => {
        const shaped = this.#shapedCell.value;
        if (shaped) owner.onShaped(shaped);
      },
      { name: "text.reportShaped" },
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
          shaped: this.#shapedCell.value?.paragraphs ?? null,
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
    this.#reports.dispose();
    this.#layoutCell.dispose();
    this.#shapedCell.dispose();
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
