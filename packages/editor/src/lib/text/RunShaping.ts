import type { ParagraphRequest, ShapedRun, ShapeUnit } from "@shift/types";
import { effect, signal } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Font } from "../model/Font";
import type { GlyphicTextItem, TextItem } from "./layout";

/** A run's paragraphs as last shaped, with the content they were shaped from. */
export interface ShapedText {
  /** The shaped content, as {@link shapingKey} gives it. */
  readonly key: string;
  /** Each paragraph's runs in logical order; clusters index the paragraph's items. */
  readonly paragraphs: readonly (readonly ShapedRun[])[];
}

/** What a run asks the shaper for, and the content it describes. */
export interface ShapingRequest {
  readonly key: string;
  readonly paragraphs: readonly ParagraphRequest[];
}

/**
 * Returns a key for the text a run shapes: its characters and picked glyphs,
 * by paragraph.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 */
export function shapingKey(items: readonly TextItem[]): string {
  return items
    .map((item) => {
      if (item.kind === "linebreak") return "\n";
      return item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`;
    })
    .join(" ");
}

/** Splits items into one shaping request per paragraph. */
export function paragraphRequests(
  items: readonly TextItem[],
  location: ParagraphRequest["location"],
): ParagraphRequest[] {
  const paragraphs: ShapeUnit[][] = [[]];
  for (const item of items) {
    if (item.kind === "linebreak") paragraphs.push([]);
    else paragraphs.at(-1)!.push(shapeUnit(item));
  }
  return paragraphs.map((units) => ({ units, location }));
}

function shapeUnit(item: GlyphicTextItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}

/**
 * Keeps one run's text shaped by the font's feature code.
 *
 * @remarks
 * Shaping runs in the workspace process, so results arrive asynchronously.
 * One request is in flight at a time; a newer request replaces any waiting
 * one, and results are published only while the shaping is alive. Readers
 * compare {@link ShapedText.key} with the run's current content before using
 * a result.
 */
export class RunShaping {
  readonly #font: Font;
  readonly #onShaped: (shaped: ShapedText) => void;
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: WritableSignal<ShapedText | null> = signal(null);
  readonly #requests: Effect;
  // non-reactive: request scheduling, never read by a reactive reader
  #inFlight = false;
  #waiting: ShapingRequest | null = null;
  #disposed = false;

  /**
   * @param requestCell - What to shape; owned by this shaping and disposed with it.
   * @param onShaped - Called with each published result, such as to load the glyphs it shows.
   */
  constructor(
    font: Font,
    requestCell: ComputedSignal<ShapingRequest | null>,
    onShaped: (shaped: ShapedText) => void,
  ) {
    this.#font = font;
    this.#onShaped = onShaped;
    this.#requestCell = requestCell;
    this.#requests = effect(
      () => {
        const request = requestCell.value;
        if (request) this.#request(request);
      },
      { name: "text.runShaping" },
    );
  }

  /** The last shaped content; null until the first result arrives. */
  get shapedCell(): Signal<ShapedText | null> {
    return this.#shapedCell;
  }

  dispose(): void {
    this.#disposed = true;
    this.#waiting = null;
    this.#requests.dispose();
    this.#requestCell.dispose();
  }

  #request(request: ShapingRequest): void {
    if (this.#inFlight) {
      this.#waiting = request;
      return;
    }
    void this.#send(request);
  }

  async #send(request: ShapingRequest): Promise<void> {
    this.#inFlight = true;
    try {
      const paragraphs = await this.#font.shapeParagraphs(request.paragraphs);
      if (!this.#disposed) {
        const shaped = { key: request.key, paragraphs };
        this.#shapedCell.set(shaped);
        this.#onShaped(shaped);
      }
    } catch (error) {
      console.error("failed to shape text", error);
    } finally {
      this.#inFlight = false;
      const next = this.#waiting;
      this.#waiting = null;
      if (next && !this.#disposed) void this.#send(next);
    }
  }
}
