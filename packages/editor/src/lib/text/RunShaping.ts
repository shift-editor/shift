import type { ParagraphRequest, ShapedParagraph, ShapeUnit } from "@shift/types";
import { effect, signal } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Font } from "../model/Font";
import type { GlyphicTextItem, TextItem } from "./layout";

/** One paragraph as last shaped, with the content it was shaped from. */
export interface KeyedParagraph {
  /** The shaped content, as {@link paragraphKeys} gives it. */
  readonly key: string;
  /** Its direction and runs in logical order; clusters index the paragraph's items. */
  readonly shaped: ShapedParagraph;
}

/** A run's paragraphs as last shaped. */
export interface ShapedText {
  readonly paragraphs: readonly KeyedParagraph[];
}

/** What a run asks the shaper for: one request and content key per paragraph. */
export interface ShapingRequest {
  readonly keys: readonly string[];
  readonly paragraphs: readonly ParagraphRequest[];
}

/**
 * Returns a key per paragraph for the text it shapes: its characters and
 * picked glyphs.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 * Location and feature settings are left out too: a result shaped with old
 * ones still maps glyphs to the right items, so it stays shown until the new
 * one arrives.
 */
export function paragraphKeys(items: readonly TextItem[]): string[] {
  const keys: string[][] = [[]];
  for (const item of items) {
    if (item.kind === "linebreak") keys.push([]);
    else keys.at(-1)!.push(item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`);
  }
  return keys.map((units) => units.join(" "));
}

/**
 * Returns each paragraph's shaping from a result shaped from that same
 * paragraph text, or null where the result is for other text.
 *
 * @remarks
 * Matching by paragraph keeps lines an edit did not touch shaped while the
 * edited line waits for its new result.
 */
export function matchShapedParagraphs(
  shaped: ShapedText | null,
  keys: readonly string[],
): (ShapedParagraph | null)[] {
  const byKey = new Map(shaped?.paragraphs.map((paragraph) => [paragraph.key, paragraph.shaped]));
  return keys.map((key) => byKey.get(key) ?? null);
}

/**
 * Splits items into one shaping request per paragraph.
 *
 * @param features - Features turned on or off by tag; others keep the font's default.
 */
export function paragraphRequests(
  items: readonly TextItem[],
  location: ParagraphRequest["location"],
  features: Readonly<Record<string, boolean>>,
): ParagraphRequest[] {
  const settings = Object.entries(features).map(([tag, on]) => ({ tag, value: on ? 1 : 0 }));
  const paragraphs: ShapeUnit[][] = [[]];
  for (const item of items) {
    if (item.kind === "linebreak") paragraphs.push([]);
    else paragraphs.at(-1)!.push(shapeUnit(item));
  }
  return paragraphs.map((units) => ({ units, location, features: settings }));
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
 * use a paragraph's result only while its content still matches; see
 * {@link matchShapedParagraphs}.
 */
export class RunShaping {
  readonly #font: Font;
  readonly #prepare: (shaped: ShapedText) => Promise<void>;
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: WritableSignal<ShapedText | null> = signal(null);
  readonly #requests: Effect;
  // non-reactive: request scheduling, never read by a reactive reader
  #inFlight = false;
  #waiting: ShapingRequest | null = null;
  #disposed = false;

  /**
   * @param requestCell - What to shape; owned by this shaping and disposed with it.
   * @param prepare - Readies a result before it is shown, such as loading the
   *   glyphs it substitutes in; the previous result stays shown meanwhile.
   */
  constructor(
    font: Font,
    requestCell: ComputedSignal<ShapingRequest | null>,
    prepare: (shaped: ShapedText) => Promise<void>,
  ) {
    this.#font = font;
    this.#prepare = prepare;
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
      const results = await this.#font.shapeParagraphs(request.paragraphs);
      if (!this.#disposed) {
        const paragraphs = results.map((shaped, index) => ({
          key: request.keys[index]!,
          shaped,
        }));
        const shaped = { paragraphs };
        // Showing a glyph before it loads draws it blank for a moment, so wait.
        await this.#prepare(shaped);
        if (!this.#disposed) this.#shapedCell.set(shaped);
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
