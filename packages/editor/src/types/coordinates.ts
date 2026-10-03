import type { Bounds, MatModel, Point2D } from "@shift/geo";

declare const space: unique symbol;

/**
 * Names the frame a point's numbers are measured in.
 *
 * @remarks
 * `screen` is CSS (logical) pixels from the canvas's top-left, Y-down, before
 * the device pixel ratio is applied. `scene` is the shared canvas that nodes are
 * placed on. `local` is one node's own units, such as a glyph's font units.
 */
export type Space = "screen" | "scene" | "local";

/**
 * A point tagged with the space it is measured in.
 *
 * @remarks
 * The tag exists only for the type checker; at runtime this is a plain
 * `Point2D`. A branded point is usable anywhere a `Point2D` is, but a plain
 * point or a point from another space is not accepted in its place. Convert
 * between spaces with {@link SpaceTransform}.
 *
 * @template S - the space the coordinates are measured in.
 */
export type PointIn<S extends Space> = Point2D & {
  readonly [space]: S;
};

/** A point in CSS (logical) pixels from the canvas's top-left, Y-down. */
export type ScreenPoint = PointIn<"screen">;

/** A point on the shared canvas that nodes are placed on. */
export type ScenePoint = PointIn<"scene">;

/** A point in one node's own units. */
export type LocalPoint = PointIn<"local">;

declare const vectorSpace: unique symbol;

/**
 * A displacement tagged with the space it is measured in, such as a drag delta or a pixel offset.
 *
 * @remarks
 * Shares `PointIn`'s `{ x, y }` shape but has its own tag, so a vector is never
 * accepted as a point or the other way round. A displacement has no position:
 * convert it with `applyLinear`, which ignores a transform's translation.
 *
 * @template S - the space the displacement is measured in.
 */
export type VectorIn<S extends Space> = Point2D & {
  readonly [vectorSpace]: S;
};

/** A displacement in CSS (logical) pixels, Y-down. */
export type ScreenVector = VectorIn<"screen">;

/** A displacement on the shared canvas that nodes are placed on. */
export type SceneVector = VectorIn<"scene">;

/** A displacement in one node's own units. */
export type LocalVector = VectorIn<"local">;

/**
 * An axis-aligned box tagged with the space its corners are measured in.
 *
 * @remarks
 * `min` and `max` are the smallest and largest coordinates on each axis, so the
 * meaning does not depend on which way Y points; Rect2D's `top` and `bottom`
 * assume Y-down. Usable anywhere a plain `Bounds` is. Move bounds between spaces
 * with `transformBounds`, never by offsetting `min` and `max`: a flip swaps them.
 *
 * @template S - the space the corners are measured in.
 */
export interface BoundsIn<S extends Space> extends Bounds {
  readonly min: PointIn<S>;
  readonly max: PointIn<S>;
}

/** A box in CSS (logical) pixels from the canvas's top-left, Y-down. */
export type ScreenBounds = BoundsIn<"screen">;

/** A box on the shared canvas that nodes are placed on. */
export type SceneBounds = BoundsIn<"scene">;

/** A box in one node's own units. */
export type LocalBounds = BoundsIn<"local">;

declare const transformSpaces: unique symbol;

/**
 * A read-only matrix that takes points in `From` to points in `To`.
 *
 * @remarks
 * Only the matrix values are exposed, so a transform cannot be changed in
 * place into a different direction. Build, apply, compose, and invert
 * transforms with the helpers in `lib/editor/spaces.ts`.
 *
 * @template From - the space of the points the transform accepts.
 * @template To - the space of the points it produces.
 */
export type SpaceTransform<From extends Space, To extends Space> = MatModel & {
  readonly [transformSpaces]: { readonly from: From; readonly to: To };
};

/** One position expressed in each coordinate space. */
export interface Coordinates {
  readonly screen: ScreenPoint;
  readonly scene: ScenePoint;
}
