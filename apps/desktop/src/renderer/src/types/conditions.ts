import type { Axis } from "@shift/editor/model";
import type { SwapId, ConditionRange, GlyphId, GlyphName } from "@shift/types";

/** One range of a condition as its chip shows it: `Weight ≥ 700`. */
export interface ConditionChip {
  readonly axis: Axis;
  /** The value after the axis's name, exactly, in user units on a font axis: `≥ 700`, `≤ 80`, `400–600`; what editing the chip starts from. */
  readonly valueText: string;
  /**
   * The value as the chip shows it: rounded (`694`, `16.8`), and a range
   * that reaches an end of the axis written open on that side (`≥ 694`).
   */
  readonly displayText: string;
  readonly range: ConditionRange;
}

/** The axes a chip's + offers, under a heading once there is more than one group. */
export interface ChipAxisGroup {
  readonly label: "Font axes" | "Glyph axes";
  readonly axes: readonly Axis[];
}

/** What a chip's typed value reads as: a range in design units, or why it can't be read. */
export type ChipReading =
  | { readonly kind: "range"; readonly range: ConditionRange }
  | { readonly kind: "problem"; readonly message: string };

/** One of the edited glyph's swaps, as the Swaps section lists it. */
export interface SwapRow {
  readonly id: SwapId;
  readonly glyphId: GlyphId;
  readonly glyphName: GlyphName;
  readonly chips: readonly ConditionChip[];
  /** Whether the canvas draws this swap at the current location. */
  readonly inUse: boolean;
  /** Why it never draws, and what the warning offers; null when it draws somewhere. */
  readonly neverUsed: NeverUsedNote | null;
}

/** What the Designspace tab's Swaps section shows for the glyph being edited. */
export interface SwapsSection {
  readonly glyphId: GlyphId;
  readonly glyphName: GlyphName;
  /** In the order they are tried; empty says how to add one. */
  readonly rows: readonly SwapRow[];
}

/**
 * The selected components' condition, as the component section's chips show
 * it: the ranges every one of them has, and whether they differ beyond them.
 */
export interface SelectedComponentCondition {
  /** The glyph they sit in, whose own axes a condition may read. */
  readonly parentGlyphId: GlyphId;
  readonly chips: readonly ConditionChip[];
  /** The components' conditions differ beyond the shared chips. */
  readonly mixed: boolean;
}

/** The glyph a new swap draws, picked in the New Swap panel: one the font has, or one to create. */
export type SwapGlyphChoice =
  | { readonly kind: "glyph"; readonly glyphId: GlyphId; readonly name: GlyphName }
  | { readonly kind: "create"; readonly name: GlyphName };

/**
 * A condition's ends as the equation popover edits them: each as typed, in
 * user units on a font axis. Which ends count is the {@link ConditionMode}.
 */
export interface ChipBounds {
  readonly min: string;
  readonly max: string;
}

/**
 * Which ends a condition sets, as the equation's operator says it: at least
 * a value (`BLED ≥ 70`), at most one (`BLED ≤ 80`), or between two. Ends are
 * inclusive.
 */
export type ConditionMode = "atLeast" | "atMost" | "between";

/** Bounds a field's text filled in, and the mode they make, or why the text can't be read. */
export type BoundsReading =
  | { readonly kind: "bounds"; readonly bounds: ChipBounds; readonly mode: ConditionMode | null }
  | { readonly kind: "problem"; readonly message: string };

/** Why a swap never draws, as its warning popover says it. */
export interface NeverUsedNote {
  /** One short sentence: "Never used: dollar.bled always wins first." */
  readonly message: string;
  /**
   * The earliest swap that always wins where this one holds, which the
   * popover offers to move it above; null when its condition holds
   * nowhere on the axes, where no move helps.
   */
  readonly shadowedBy: { readonly id: SwapId; readonly glyphName: string } | null;
}
