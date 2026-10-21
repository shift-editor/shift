import type { GlyphEntry, ShaperFont } from "@shift/types";
import { effect, signal } from "../signals";
import type { Effect, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import { SerialRequest } from "../utils/SerialRequest";
import { loadShaping, type RegisteredShaper } from "../wasm/shaping";

/**
 * Keeps the shaper the editor shapes proof text with current.
 *
 * @remarks
 * Proof text shapes synchronously in `@shift/wasm/shaping`, with a shaper
 * font the workspace compiles from feature code. Fetching it, and loading the
 * module the first time, are the only asynchronous steps, taken when the
 * glyph directory changes, not per keystroke. Until the first
 * shaper is ready, {@link shaperCell} is null and text lays out literally.
 */
export class TextShaper {
  readonly #shaperCell: WritableSignal<RegisteredShaper | null> = signal(null, {
    name: "text.shaper",
  });
  /** The last shaper font the workspace sent, for remapping characters alone. */
  #font: ShaperFont | null = null;
  readonly #refresh: SerialRequest<readonly GlyphEntry[], RegisteredShaper | null>;
  readonly #refreshes: Effect;

  constructor(editor: Editor) {
    this.#refresh = new SerialRequest(
      (glyphs) => this.#shaper(editor, glyphs),
      (_glyphs, shaper) => this.#shaperCell.set(shaper),
      (error) => console.error("failed to prepare shaping", error),
    );
    this.#refreshes = effect(
      () => {
        // A preview reads its source without a workspace, which compiles features.
        if (editor.sessionMode === "preview") return;
        this.#refresh.request(editor.font.glyphEntriesCell.value);
      },
      { name: "text.shaperRefresh" },
    );
  }

  /** The shaper to shape with; null until the first one is ready. */
  get shaperCell(): Signal<RegisteredShaper | null> {
    return this.#shaperCell;
  }

  /** Resolves once the shaper reflects the latest glyph directory. */
  settled(): Promise<void> {
    return this.#refresh.settled();
  }

  dispose(): void {
    this.#refreshes.dispose();
    this.#refresh.dispose();
  }

  /**
   * Registers the current shaper font with the glyph directory's character
   * mapping, fetching the font only when its revision changed.
   */
  async #shaper(editor: Editor, glyphs: readonly GlyphEntry[]): Promise<RegisteredShaper | null> {
    const { RegisteredShaper } = await loadShaping();
    const fresh = await editor.font.shaperFont(this.#font?.revision ?? null);
    this.#font = fresh ?? this.#font;
    return this.#font ? new RegisteredShaper(this.#font, glyphs) : null;
  }
}
