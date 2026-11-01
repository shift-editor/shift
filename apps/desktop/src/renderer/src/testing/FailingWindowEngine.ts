import type { GlyphId } from "@shift/types";
import type { LayoutRequest, PlacedText } from "@shift/wasm/protocol";
import type { KerningPlace } from "@shift/editor/types";
import { WindowEngine } from "@/lib/engine/WindowEngine";

/**
 * The window's real engine, which a test can make fail its next text layout
 * or glyph preload, as a store that cannot answer or text too long to lay
 * out would. Every other read and edit is the real engine's.
 */
export class FailingWindowEngine extends WindowEngine {
  #layoutFailure: Error | null = null;
  #preloadFailure: Error | null = null;

  /** Makes the next layout read throw `error`. */
  failNextLayout(error: Error): void {
    this.#layoutFailure = error;
  }

  /** Makes the next glyph preload throw `error`. */
  failNextPreload(error: Error): void {
    this.#preloadFailure = error;
  }

  override layoutText(text: LayoutRequest, place: KerningPlace): PlacedText | null {
    const failure = this.#layoutFailure;
    this.#layoutFailure = null;
    if (failure) throw failure;
    return super.layoutText(text, place);
  }

  override preload(glyphIds: readonly GlyphId[]): void {
    const failure = this.#preloadFailure;
    this.#preloadFailure = null;
    if (failure) throw failure;
    super.preload(glyphIds);
  }
}
