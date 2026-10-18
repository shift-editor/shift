import type { ParagraphRequest, RunId, ShapedParagraph, ShapeUnit } from "@shift/types";
import { computed, effect, signal, track } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import type { RegisteredShaper } from "../wasm/shaping";
import { locationFromExternalAxisLocation } from "../variation/location";
import { splitParagraphs, TextLayout, type Paragraph, type ParagraphItem } from "./layout";

/** A run's paragraphs as shaped, with the content each was shaped from. */
export interface ShapedText {
  /** Each paragraph's content, as {@link paragraphKey} gives it, indexed like `paragraphs`. */
  readonly keys: readonly string[];
  /**
   * Each paragraph's direction and runs in logical order, indexed like
   * `splitParagraphs`; null for a paragraph that could not be shaped, which
   * lays out literally.
   */
  readonly paragraphs: readonly (ShapedParagraph | null)[];
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
  /** The shaper to shape with; null until it is ready, when text lays out literally. */
  readonly shaperCell: Signal<RegisteredShaper | null>;
  /** Whether every glyph a shaping result shows is loaded; reactive through `glyphsLoadedCell`. */
  isLoaded(shaped: ShapedText): boolean;
  /** Starts loading the glyphs a shaping result substitutes in, which no item names directly. */
  load(shaped: ShapedText): void;
}

/**
 * Keeps one run's text shaped and laid out.
 *
 * @remarks
 * Shaping runs synchronously in `@shift/wasm/shaping`, so the layout shapes
 * text in the same pass that changes it. Only a result that substitutes in an
 * unloaded glyph waits: the last ready result stays shown until the glyph
 * loads, so a new ligature never draws blank. Until the owner's shaper is
 * ready the text lays out literally, as does a run with shaping off.
 * Construct outside any reactive reader: the effect that loads substituted
 * glyphs starts at once.
 */
export class RunText {
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: ComputedSignal<ShapedText | null>;
  /** The last result whose glyphs were all loaded, shown while a newer one waits on loads. */
  readonly #readyCell: WritableSignal<ShapedText | null> = signal(null, { name: "text.ready" });
  readonly #loads: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
    this.#requestCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        // A preview reads its source without a workspace, which compiles the shaper font.
        if (!record?.shaping || editor.sessionMode === "preview") return null;
        // A glyph's new Unicode value can change what the text shapes to.
        track(editor.font.glyphEntriesCell);
        const location = locationFromExternalAxisLocation(editor.externalLocationCell.value);
        const features = featureSettings(record);
        const split = splitParagraphs(record.items);
        if (split.length === 0) return null;
        return {
          keys: split.map(paragraphKey),
          paragraphs: split.map((paragraph) => ({
            units: paragraph.items.map(shapeUnit),
            location,
            features,
          })),
        };
      },
      { name: "text.shapingRequest" },
    );

    this.#shapedCell = computed(
      () => {
        const request = this.#requestCell.value;
        const shaper = owner.shaperCell.value;
        if (!request || !shaper) return null;
        return { keys: request.keys, paragraphs: shaper.shapeParagraphs(request.paragraphs) };
      },
      { name: "text.shaped" },
    );

    this.#loads = effect(
      () => {
        const shaped = this.#shapedCell.value;
        if (!shaped) return;
        if (owner.isLoaded(shaped)) {
          this.#readyCell.set(shaped);
          return;
        }
        owner.load(shaped);
      },
      { name: "text.loadShaped" },
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
        const shaped = record.shaping ? this.#shownFor(record, owner) : null;
        return new TextLayout({
          items: record.items,
          origin: { x: 0, y: 0 },
          editor,
          externalLocation: editor.externalLocationCell,
          shaped,
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
    this.#loads.dispose();
    this.#layoutCell.dispose();
    this.#shapedCell.dispose();
    this.#requestCell.dispose();
  }

  /**
   * Returns the paragraphs to show: the current result once its glyphs are
   * loaded, otherwise the last ready one's paragraphs whose text is
   * unchanged, matched by content, so only an edited paragraph lays out
   * literally while its glyphs load.
   */
  #shownFor(
    record: TextRunRecord,
    owner: RunTextOwner,
  ): readonly (ShapedParagraph | null)[] | null {
    // Called from the layout computed: track, then read. The ready result is
    // tracked only while it is shown, so publishing it does not re-lay out.
    track(this.#shapedCell);
    const shaped = this.#shapedCell.peek();
    if (shaped && owner.isLoaded(shaped)) return shaped.paragraphs;
    track(this.#readyCell);
    const ready = this.#readyCell.peek();
    if (!ready) return null;
    // A paragraph shaped from other text would map glyphs to the wrong items.
    const byKey = new Map(ready.keys.map((key, index) => [key, ready.paragraphs[index] ?? null]));
    return splitParagraphs(record.items).map(
      (paragraph) => byKey.get(paragraphKey(paragraph)) ?? null,
    );
  }
}

/** The run's feature settings: features turned on or off by tag; others keep the font's default. */
function featureSettings(record: TextRunRecord): { tag: string; value: number }[] {
  return Object.entries(record.features).map(([tag, on]) => ({ tag, value: on ? 1 : 0 }));
}

/**
 * Returns a key for the text a paragraph shapes: its characters and picked
 * glyphs.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 */
function paragraphKey(paragraph: Paragraph): string {
  return paragraph.items
    .map((item) => (item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`))
    .join(" ");
}

function shapeUnit(item: ParagraphItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}
