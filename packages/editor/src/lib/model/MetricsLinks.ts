import type { GlyphId, MetricsKeySide } from "@shift/types";
import type { SideLink } from "@shift/wasm/protocol";
import type { Font } from "./Font";
import type { GlyphLayer } from "./Glyph";

/** A key starting `==` is set on the layer: it applies in that source only. */
const LOCAL_KEY_PREFIX = "==";

/**
 * The sides whose keys would pull an edit of `side` back: a right
 * sidebearing and a width set the same edge, so editing either breaks both.
 */
const SIDES_HOLDING: Record<MetricsKeySide, readonly MetricsKeySide[]> = {
  left: ["left"],
  right: ["right", "width"],
  width: ["width", "right"],
};

/**
 * The metrics keys of one glyph in one source: what the glyph sidebar and the
 * Spacing tool show and change.
 *
 * @remarks
 * Rust decides which key applies, whether it can, and what it gives; this
 * reads those answers and sends the intents that set or clear keys.
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
    return this.sides.find((link) => link.side === side) ?? null;
  }

  /**
   * Links `side` with `key`, as one undo step. A key starting `==` is this
   * source's own; any other is the glyph's, for every source, and replaces a
   * key this source had of its own for the side so the glyph's applies.
   *
   * @returns Why the key was refused, such as a name no glyph has; null when it was set.
   */
  link(side: MetricsKeySide, key: string): string | null {
    const problem = this.#font.metricsKeyProblem(key);
    if (problem !== null) return problem;

    this.#font.editCoordinator.transaction("Link metrics", () => {
      if (key.trimStart().startsWith(LOCAL_KEY_PREFIX)) {
        this.#layer.setMetricsKey(side, key);
        return;
      }
      if (this.side(side)?.level === "layer") this.#layer.setMetricsKey(side, null);
      this.#font.setGlyphMetricsKey(this.#glyphId, side, key);
    });
    return null;
  }

  /**
   * Clears the keys that would pull an edit of `side` back, where each is
   * set: a glyph's key stops applying in every source. Call it in the edit's
   * transaction, so breaking the link and the edit undo together.
   */
  unlinkFor(side: MetricsKeySide): void {
    for (const held of SIDES_HOLDING[side]) {
      const link = this.side(held);
      if (!link) continue;

      if (link.level === "layer") {
        this.#layer.setMetricsKey(held, null);
      } else {
        this.#font.setGlyphMetricsKey(this.#glyphId, held, null);
      }
    }
  }
}
