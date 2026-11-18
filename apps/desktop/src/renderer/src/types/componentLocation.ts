import type { Axis } from "@shift/editor/model";

/**
 * Whose axis a component sets: the font's, or one of its base glyph's own,
 * which is in its own units and never inherited.
 */
export type ComponentAxisKind = "font" | "glyph";

/** One axis the selected components set at the active source. */
export interface SetComponentAxis {
  readonly axis: Axis;
  readonly kind: ComponentAxisKind;
  /** Where the base glyph draws on it, in user units; null when the components differ. */
  readonly value: number | null;
}

/**
 * An axis the selected components don't set, and where they follow it to
 * now, in user units: a glyph axis stays at its default.
 */
export interface FollowedComponentAxis {
  readonly axis: Axis;
  readonly kind: ComponentAxisKind;
  readonly follows: number;
}

/** What the Designspace tab's component section shows for the selected components. */
export interface SelectedComponentLocation {
  /** The base glyph they draw, or how many components when their bases differ. */
  readonly title: string;
  readonly set: readonly SetComponentAxis[];
  readonly followed: readonly FollowedComponentAxis[];
}
