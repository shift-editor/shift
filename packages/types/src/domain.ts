import type {
  GlyphSnapshot,
  ContourSnapshot,
  PointSnapshot,
  DecomposedTransform as DecomposedTransformGenerated,
} from "./generated";

export type Point = Readonly<PointSnapshot>;

export type DecomposedTransform = Readonly<DecomposedTransformGenerated>;

export type Contour = Readonly<Omit<ContourSnapshot, "points">> & {
  readonly points: readonly Point[];
};

export type Glyph = Readonly<Omit<GlyphSnapshot, "contours">> & {
  readonly contours: readonly Contour[];
};
