import type { Axis } from "@shift/editor/model";
import type { LayerId } from "@shift/types";

/** One of the edited glyph's own axes, and where the canvas draws the glyph on it. */
export interface GlyphAxisRow {
  readonly axis: Axis;
  /** In the axis's own units. */
  readonly value: number;
}

/** What the Designspace tab's Glyph axes section shows for the glyph being edited. */
export interface GlyphAxesSection {
  readonly glyphName: string;
  /** Empty for a glyph with no axes of its own: the section shows how to add one. */
  readonly rows: readonly GlyphAxisRow[];
}

/** A drawing of the edited glyph located off the font's sources, as the Sources list shows it. */
export interface GlyphDrawingRow {
  readonly layerId: LayerId;
  /** Where it sits, "Spread 100" or "Bleed 50". */
  readonly name: string;
  /** Whether it is the drawing being edited. */
  readonly active: boolean;
}

/** A glyph axis as its form edits it: a name and a range in the axis's own units. */
export interface GlyphAxisDraft {
  readonly name: string;
  readonly minimum: number;
  readonly default: number;
  readonly maximum: number;
}
