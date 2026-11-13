import type { GlyphId, MetricsKeySide } from "@shift/types";
import type { SideLink } from "@shift/wasm/protocol";
import type { Sidebearing } from "../../types/spacing";
import type { Font } from "./Font";
import type { GlyphLayer } from "./Glyph";

/** The metrics-key side each sidebearing is. */
export const SIDE_OF_SIDEBEARING: Record<Sidebearing, MetricsKeySide> = {
  lsb: "left",
  rsb: "right",
};

/** The link on `side` among `sides`, or null when the side is not linked. */
export function linkOn(sides: readonly SideLink[], side: MetricsKeySide): SideLink | null {
  return sides.find((link) => link.side === side) ?? null;
}

/**
 * The metrics keys of one glyph in one source: what the glyph sidebar and the
 * Spacing tool show and change.
 *
 * @remarks
 * Rust decides which key applies, whether it can, what it gives, where a
 * typed key is set and which keys an edit breaks; this reads its answers and
 * sends the intents that ask it.
 */
export class MetricsLinks {
  readonly #font: Font;
  readonly #glyphId: GlyphId;
  readonly #layer: GlyphLayer;

  constructor(font: Font, glyphId: GlyphId, layer: GlyphLayer) {
    this.#font = font;
    this.#glyphId = glyphId;
    this.#layer = layer;
  }

  /** The glyph's layer in the source these links are read for. */
  get layer(): GlyphLayer {
    return this.#layer;
  }

  /**
   * The linked sides, left, right, then width. Reading it in a reactive body
   * subscribes to edits.
   */
  get sides(): readonly SideLink[] {
    return this.#font.linkedSides(this.#glyphId, this.#layer.sourceId);
  }

  /** The link on `side`, or null when the side is not linked. */
  side(side: MetricsKeySide): SideLink | null {
    return linkOn(this.sides, side);
  }

  /**
   * Links `side` with `key` as one undo step: a key starting `==` is this
   * source's own, any other the glyph's for every source, and blank text
   * removes the side's key, keeping its value.
   *
   * @returns Why the key was refused, such as a name no glyph has; null when it was set.
   */
  link(side: MetricsKeySide, key: string): string | null {
    const problem = this.#font.metricsKeyProblem(key);
    if (problem !== null) return problem;

    this.#font.editCoordinator.transaction("Link metrics", () => {
      this.#layer.linkMetricsSide(side, key);
    });
    return null;
  }

  /**
   * Clears the keys that would pull an edit of `side` back. Call it in the
   * edit's transaction or preview, so breaking the link and the edit go
   * together.
   */
  unlinkFor(side: MetricsKeySide): void {
    this.#layer.unlinkMetricsSide(side);
  }
}
