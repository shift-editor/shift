import type { GlyphId, TextItemId } from "@shift/types";
import type { TextRunNode } from "./node";

/** Which half of a gap: the left glyph's right sidebearing, or the right glyph's left one. */
export type SpacingSideName = "left" | "right";

/** A glyph's left or right sidebearing. */
export type Sidebearing = "lsb" | "rsb";

/** The sidebearing that forms a half of a gap: the left half is the left glyph's RSB. */
export function sidebearingOfHalf(half: SpacingSideName): Sidebearing {
  return half === "left" ? "rsb" : "lsb";
}

/** One glyph's side of a spacing gap, in its run's units. */
export interface SpacingSide {
  readonly itemId: TextItemId;
  readonly glyphId: GlyphId;
  /** The sidebearing facing the gap, at the displayed location. */
  readonly sidebearing: number;
  /** X of the outline edge facing the gap. */
  readonly edge: number;
}

/**
 * The space between two neighbouring glyphs of a run, or before the first or after the last.
 *
 * @remarks
 * `left` is the glyph before the gap, whose right sidebearing faces it;
 * `right` is the glyph after, whose left sidebearing faces it. Either is
 * null at a line end or next to a glyph without an outline. Each sidebearing
 * is measured to its own glyph's advance edge, so kerning between the pair
 * (the distance between the two boundaries) belongs to neither. All x and y
 * values are in the run's units.
 */
export interface SpacingGap {
  readonly node: TextRunNode;
  readonly left: SpacingSide | null;
  readonly right: SpacingSide | null;
  /** X where the left glyph's advance ends; equals `rightBoundary` at a line start. */
  readonly leftBoundary: number;
  /** X where the right glyph's advance begins; equals `leftBoundary` at a line end. */
  readonly rightBoundary: number;
  readonly top: number;
  readonly bottom: number;
}

/** The advance edge a half's sidebearing is measured to. */
export function spacingBoundary(gap: SpacingGap, half: SpacingSideName): number {
  return half === "left" ? gap.leftBoundary : gap.rightBoundary;
}

/** The middle of a gap's kerning, or its single boundary when unkerned. */
export function spacingGapCenter(gap: SpacingGap): number {
  return (gap.leftBoundary + gap.rightBoundary) / 2;
}
