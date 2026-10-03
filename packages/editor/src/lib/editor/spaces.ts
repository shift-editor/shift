import { Mat, type Bounds, type MatModel } from "@shift/geo";
import type {
  BoundsIn,
  LocalBounds,
  LocalPoint,
  LocalVector,
  PointIn,
  SceneBounds,
  ScenePoint,
  SceneVector,
  ScreenBounds,
  ScreenPoint,
  ScreenVector,
  Space,
  SpaceTransform,
  VectorIn,
} from "../../types/coordinates";

/**
 * Returns a point in canvas logical pixels, measured from the canvas's top-left.
 *
 * @remarks
 * Use where a pointer position or a known pixel offset enters the editor. To
 * convert an existing point from another space, apply a {@link SpaceTransform}.
 */
export function screenPoint(x: number, y: number): ScreenPoint {
  return { x, y } as ScreenPoint;
}

/**
 * Returns a point on the shared canvas that nodes are placed on.
 *
 * @remarks
 * Use for positions that are authored in scene units. To convert an existing
 * point from another space, apply a {@link SpaceTransform}.
 */
export function scenePoint(x: number, y: number): ScenePoint {
  return { x, y } as ScenePoint;
}

/**
 * Returns a point in one node's own units.
 *
 * @remarks
 * The node is implied by the caller. To convert an existing point from another
 * space, apply a {@link SpaceTransform}.
 */
export function localPoint(x: number, y: number): LocalPoint {
  return { x, y } as LocalPoint;
}

/**
 * Returns plain bounds tagged as canvas logical pixels.
 *
 * @param bounds - corners already measured in screen space.
 */
export function screenBounds(bounds: Bounds): ScreenBounds {
  return bounds as ScreenBounds;
}

/**
 * Returns plain bounds tagged as scene units.
 *
 * @param bounds - corners already measured in scene space.
 */
export function sceneBounds(bounds: Bounds): SceneBounds {
  return bounds as SceneBounds;
}

/**
 * Returns plain bounds tagged as one node's own units.
 *
 * @param bounds - corners already measured in the node's units.
 */
export function localBounds(bounds: Bounds): LocalBounds {
  return bounds as LocalBounds;
}

/**
 * Returns a transform between two spaces built from a copy of `matrix`.
 *
 * @remarks
 * This is the one place a plain matrix becomes a transform, so the caller
 * states the direction here. Later changes to `matrix` do not affect the
 * result.
 *
 * @param matrix - takes points in `From` to points in `To`; not retained.
 */
export function spaceTransform<From extends Space, To extends Space>(
  matrix: MatModel,
): SpaceTransform<From, To> {
  const copy: MatModel = Mat.Copy(matrix);
  return copy as SpaceTransform<From, To>;
}

/**
 * Returns the same position expressed in the transform's target space.
 *
 * @param transform - decides both spaces; the point must be in its source space.
 * @param point - a point in the transform's source space.
 * @returns a new point; `point` is not modified.
 */
export function applyTransform<From extends Space, To extends Space>(
  transform: SpaceTransform<From, To>,
  point: PointIn<NoInfer<From>>,
): PointIn<To> {
  const newPoint = Mat.applyToPoint(transform, point);
  return newPoint as PointIn<To>;
}

/**
 * Returns a transform that applies `first` and then `second`.
 *
 * @remarks
 * Arguments follow matrix multiplication order, as `Mat.Compose` does, so
 * `composeTransforms(bToC, aToB)` is `aToC`.
 *
 * @param second - applied last; its source space is the space `first` ends in.
 * @param first - applied first; must end in the space `second` starts from.
 */
export function composeTransforms<A extends Space, B extends Space, C extends Space>(
  second: SpaceTransform<B, C>,
  first: SpaceTransform<A, NoInfer<B>>,
): SpaceTransform<A, C> {
  const c = Mat.Compose(second, first);
  return spaceTransform(c);
}

/**
 * Returns the transform that undoes `transform`, going from `To` back to `From`.
 *
 * @throws {Error} when the matrix is singular, such as a zero scale.
 */
export function invertTransform<From extends Space, To extends Space>(
  transform: SpaceTransform<From, To>,
): SpaceTransform<To, From> {
  return spaceTransform(Mat.Inverse(transform));
}

/** Returns a displacement in canvas logical pixels. */
export function screenVector(x: number, y: number): ScreenVector {
  return { x, y } as ScreenVector;
}

/** Returns a displacement in scene units. */
export function sceneVector(x: number, y: number): SceneVector {
  return { x, y } as SceneVector;
}

/** Returns a displacement in one node's own units. */
export function localVector(x: number, y: number): LocalVector {
  return { x, y } as LocalVector;
}

/**
 * Returns the displacement from `from` to `to`, in their shared space.
 *
 * @param from - the start point.
 * @param to - the end point; must be in the same space as `from`.
 */
export function vectorBetween<S extends Space>(
  from: PointIn<S>,
  to: PointIn<NoInfer<S>>,
): VectorIn<S> {
  return { x: to.x - from.x, y: to.y - from.y } as VectorIn<S>;
}

/**
 * Returns `point` moved by `offset`.
 *
 * @param point - the point to move.
 * @param offset - a displacement in the same space as `point`.
 */
export function translatePoint<S extends Space>(
  point: PointIn<S>,
  offset: VectorIn<NoInfer<S>>,
): PointIn<S> {
  return { x: point.x + offset.x, y: point.y + offset.y } as PointIn<S>;
}

/**
 * Returns a displacement expressed in the transform's target space.
 *
 * @remarks
 * Applies only the linear part (scale, flip, rotation): a displacement has no
 * position, so the transform's translation does not apply.
 *
 * @param transform - decides both spaces; the vector must be in its source space.
 * @param vector - a displacement in the transform's source space.
 */
export function applyLinear<From extends Space, To extends Space>(
  transform: SpaceTransform<From, To>,
  vector: VectorIn<NoInfer<From>>,
): VectorIn<To> {
  return {
    x: transform.a * vector.x + transform.c * vector.y,
    y: transform.b * vector.x + transform.d * vector.y,
  } as VectorIn<To>;
}

/**
 * Returns the bounds, in the transform's target space, that contain `bounds`.
 *
 * @remarks
 * Transforms all four corners and takes their bounding box, so a flip or
 * rotation that swaps `min` and `max` still produces valid bounds.
 *
 * @param transform - decides both spaces; the bounds must be in its source space.
 * @param bounds - bounds in the transform's source space.
 */
export function transformBounds<From extends Space, To extends Space>(
  transform: SpaceTransform<From, To>,
  bounds: BoundsIn<NoInfer<From>>,
): BoundsIn<To> {
  const { min, max } = bounds;
  const corners = [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }].map((corner) =>
    Mat.applyToPoint(transform, corner),
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } as BoundsIn<To>;
}
