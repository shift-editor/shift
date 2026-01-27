import type { GlyphSnapshot, ContourSnapshot, PointSnapshot } from "./generated";

export type Point = Readonly<PointSnapshot>;

export type Contour = Readonly<Omit<ContourSnapshot, "points">> & {
  readonly points: readonly Point[];
};

export type Glyph = Readonly<Omit<GlyphSnapshot, "contours">> & {
  readonly contours: readonly Contour[];
};
