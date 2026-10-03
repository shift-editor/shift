import type { Point2D } from "@shift/geo";
import type {
  LocalBounds,
  SceneBounds,
  ScenePoint,
  SceneVector,
  ScreenPoint,
  ScreenVector,
  SpaceTransform,
} from "../../types/coordinates";
import {
  applyLinear,
  applyTransform,
  composeTransforms,
  invertTransform,
  transformBounds,
  translatePoint,
  vectorBetween,
} from "./spaces";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type Assignable<From, To> = [From] extends [To] ? true : false;

export type BrandedPointIsAPoint = Assert<Assignable<ScenePoint, Point2D>>;
export type PlainPointIsNotBranded = Assert<Equal<Assignable<Point2D, ScenePoint>, false>>;
export type PointSpacesStayDistinct = Assert<Equal<Assignable<ScreenPoint, ScenePoint>, false>>;
export type TransformDirectionsStayDistinct = Assert<
  Equal<Assignable<SpaceTransform<"scene", "screen">, SpaceTransform<"screen", "scene">>, false>
>;

declare const view: SpaceTransform<"scene", "screen">;
declare const placement: SpaceTransform<"local", "scene">;
declare const scenePoint: ScenePoint;
declare const screenPoint: ScreenPoint;

export const projected = applyTransform(view, scenePoint);
export type ApplyReturnsTargetSpace = Assert<Equal<typeof projected, ScreenPoint>>;

// @ts-expect-error the view takes scene points, not screen points
applyTransform(view, screenPoint);

export const localToScreen = composeTransforms(view, placement);
export type ComposeConnectsSpaces = Assert<
  Equal<typeof localToScreen, SpaceTransform<"local", "screen">>
>;

// @ts-expect-error the view ends in screen space, which the placement does not start from
composeTransforms(placement, view);

export const inverseView = invertTransform(view);
export type InvertFlipsDirection = Assert<
  Equal<typeof inverseView, SpaceTransform<"screen", "scene">>
>;

export type VectorIsNotAPoint = Assert<Equal<Assignable<SceneVector, ScenePoint>, false>>;
export type PointIsNotAVector = Assert<Equal<Assignable<ScenePoint, SceneVector>, false>>;
export type VectorSpacesStayDistinct = Assert<Equal<Assignable<ScreenVector, SceneVector>, false>>;

declare const sceneOffset: SceneVector;
declare const screenOffset: ScreenVector;
declare const localBounds: LocalBounds;
declare const sceneBounds: SceneBounds;

// @ts-expect-error a displacement needs two points in the same space
vectorBetween(scenePoint, screenPoint);

export const moved = translatePoint(scenePoint, sceneOffset);
export type TranslateKeepsSpace = Assert<Equal<typeof moved, ScenePoint>>;

// @ts-expect-error a pixel offset cannot move a scene point
translatePoint(scenePoint, screenOffset);

// @ts-expect-error a displacement has no position for the view to translate
applyTransform(view, sceneOffset);

// @ts-expect-error applyLinear converts displacements, not positions
applyLinear(view, scenePoint);

export const projectedOffset = applyLinear(view, sceneOffset);
export type ApplyLinearReturnsTargetSpace = Assert<Equal<typeof projectedOffset, ScreenVector>>;

export const placedBounds = transformBounds(placement, localBounds);
export type TransformBoundsReturnsTargetSpace = Assert<Equal<typeof placedBounds, SceneBounds>>;

// @ts-expect-error the placement takes local bounds, not scene bounds
transformBounds(placement, sceneBounds);
