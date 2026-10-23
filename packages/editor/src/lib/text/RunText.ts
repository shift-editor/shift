import type { GlyphId, ParagraphRequest, RunId, ShapedRun, ShapeUnit } from "@shift/types";
import { computed, effect, track } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import type { RegisteredShaper } from "../wasm/shaping";
import { locationFromExternalAxisLocation } from "../variation/location";
import {
  glyphIdForItem,
  splitParagraphs,
  TextLayout,
  type ParagraphItem,
  type TextItem,
} from "./layout";

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
  /** Bumped when a load of a glyph text needs finishes, whether or not it loaded; followed by runs waiting for their first layout. */
  readonly glyphsLoadedCell: Signal<number>;
  /** Whether a glyph text needs is being loaded. Not reactive: {@link glyphsLoadedCell} bumps when a load ends. */
  isLoading(glyphId: GlyphId): boolean;
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
  /** Whether the run has had a layout; only its first waits for its glyphs. */
  #laidOut = false;

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
        if (!record) return null;
        // A new run waits for glyphs on their way rather than laying out
        // without them and again when they land, which cost a page of runs
        // a whole extra layout. Once shown, a run lays out with what has
        // loaded, so typing a glyph not loaded yet does not blank it, and
        // follows only its own glyphs, which the layout reads one by one:
        // following every load would re-lay out every run on the page.
        if (!this.#laidOut) {
          track(owner.glyphsLoadedCell);
          if (waitsForGlyphs(record.items, editor, owner)) return null;
        }

        this.#laidOut = true;
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

  /**
   * The run's layout; invalidates on content, location, source, glyph loads, and shaping results.
   *
   * @remarks
   * Null until the run has text and, the first time, until the glyphs its
   * items name have finished loading.
   */
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

/** Whether any glyph the items name is still loading. */
function waitsForGlyphs(items: readonly TextItem[], editor: Editor, owner: RunTextOwner): boolean {
  return items.some((item) => {
    if (item.kind === "linebreak") return false;
    const glyphId = glyphIdForItem(item, editor.font);
    return glyphId !== null && owner.isLoading(glyphId);
  });
}

function shapeUnit(item: ParagraphItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}
