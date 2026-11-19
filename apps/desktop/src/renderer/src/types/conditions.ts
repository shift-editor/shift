import type { Axis } from "@shift/editor/model";
import type { AlternateId, ConditionRange, GlyphId, GlyphName } from "@shift/types";

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

/** One of the edited glyph's alternates, as the Alternates section lists it. */
export interface AlternateRow {
  readonly id: AlternateId;
  readonly glyphId: GlyphId;
  readonly glyphName: GlyphName;
  readonly chips: readonly ConditionChip[];
  /** Whether the canvas draws this alternate at the current location. */
  readonly inUse: boolean;
  /** Why it never draws, as the row's note says it; null when it draws somewhere. */
  readonly neverUsed: string | null;
}

/** What the Designspace tab's Alternates section shows for the glyph being edited. */
export interface AlternatesSection {
  readonly glyphId: GlyphId;
  readonly glyphName: GlyphName;
  /** In the order they are tried; empty reads "None". */
  readonly rows: readonly AlternateRow[];
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

/** The glyph a new alternate draws, picked in the New Alternate panel: one the font has, or one to create. */
export type AlternateGlyphChoice =
  | { readonly kind: "glyph"; readonly glyphId: GlyphId; readonly name: GlyphName }
  | { readonly kind: "create"; readonly name: GlyphName };
