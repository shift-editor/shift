import { Vec2 } from "@shift/geo";
import { Contours, Glyphs } from "@shift/font";
import { Validate } from "@shift/validation";
import type { Glyph, Point2D, PointId } from "@shift/types";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  Snap,
  PointSnapResult,
  PointSnapStep,
  RotateSnapSession,
  RotateSnapResult,
  RotateSnapStep,
  SnapContext,
  SnappableObject,
  SnappableQuery,
} from "../snapping/types";
import { SnapPipelineRunner } from "../snapping/SnapPipelineRunner";
import {
  createPointToPointStep,
  createMetricsStep,
  createAngleStep,
  createRotateAngleStep,
  collectMetricSources,
} from "../snapping/steps";

/**
 * Creates and configures snap sessions for drag and rotate operations.
 *
 * A snap session is a stateful object that lives for the duration of a single
 * drag or rotation gesture. It captures the snappable objects (other points,
 * metric lines) at session start so the pipeline does not recompute them on
 * every mouse move. The manager itself is stateless between sessions.
 *
 * Depends on four callbacks (`Snap`) to read glyph data,
 * font metrics, user preferences, and the current screen-to-UPM scale factor.
 */
export class SnapManager {
  readonly #deps: Snap;
  readonly #runner: SnapPipelineRunner;

  constructor(deps: Snap) {
    this.#deps = deps;
    this.#runner = new SnapPipelineRunner();
  }

  /**
   * Creates a drag snap session for point translation.
   *
   * Freezes the set of snap targets (excluding the dragged points) and
   * resolves the anchor position and snap reference at creation time. The
   * returned session's `snap()` method runs the point-to-point, metrics, and
   * angle snap steps on each call.
   *
   * For control (off-curve) points the snap reference is the adjacent anchor,
   * so angle snapping measures from the parent anchor rather than the control
   * point's own position.
   */
  createDragSession(config: DragSnapSessionConfig): DragSnapSession {
    const context: SnapContext = { previousSnappedAngle: null };
    const steps: PointSnapStep[] = [
      createPointToPointStep(),
      createMetricsStep(),
      createAngleStep(),
    ];
    const sources = this.getSnappableObjects({
      include: ["points", "metrics"],
      excludedPointIds: config.excludedPointIds,
    });

    const glyph = this.#deps.getGlyph();
    const anchorPosition = this.getAnchorPosition(glyph, config.anchorPointId, config.dragStart);
    const reference = this.resolveSnapReference(glyph, config.anchorPointId, config.dragStart);

    return {
      getAnchorPosition: () => anchorPosition,
      snap: (cursorPoint, modifiers): PointSnapResult => {
        const pointPosition = Vec2.add(anchorPosition, Vec2.sub(cursorPoint, config.dragStart));
        const prefs = this.#deps.getSnapPreferences();

        return this.#runner.runPointPipeline(steps, {
          point: pointPosition,
          reference,
          modifiers,
          context,
          sources,
          preferences: prefs,
          radius: this.#deps.screenToUpmDistance(prefs.pointRadiusPx),
          increment: (prefs.angleIncrementDeg * Math.PI) / 180,
        });
      },
      clear: () => {
        context.previousSnappedAngle = null;
      },
    };
  }

  /**
   * Creates a rotation snap session.
   *
   * The returned session snaps rotation deltas to the configured angle
   * increment (e.g. 45-degree steps) when shift is held. Maintains
   * `previousSnappedAngle` for hysteresis between snap events.
   */
  createRotateSession(): RotateSnapSession {
    const context: SnapContext = { previousSnappedAngle: null };
    const steps: RotateSnapStep[] = [createRotateAngleStep()];

    return {
      snap: (delta, modifiers): RotateSnapResult => {
        const prefs = this.#deps.getSnapPreferences();

        return this.#runner.runRotatePipeline(steps, {
          delta,
          modifiers,
          context,
          preferences: prefs,
          increment: (prefs.angleIncrementDeg * Math.PI) / 180,
        });
      },
      clear: () => {
        context.previousSnappedAngle = null;
      },
    };
  }

  /** Freezes the set of snap targets (points + metric lines) for a session. */
  private getSnappableObjects(query: SnappableQuery): SnappableObject[] {
    const result: SnappableObject[] = [];

    if (query.include.includes("points")) {
      const excluded = new Set(query.excludedPointIds ?? []);
      const glyph = this.#deps.getGlyph();
      if (glyph) {
        for (const { point } of Glyphs.points(glyph)) {
          if (excluded.has(point.id)) continue;
          result.push({
            kind: "pointTarget",
            id: point.id,
            point: { x: point.x, y: point.y },
          });
        }
      }
    }

    if (query.include.includes("metrics")) {
      result.push(...collectMetricSources(this.#deps.getMetrics()));
    }

    return result;
  }

  /**
   * Looks up the position of the point being dragged at session start.
   * Falls back to the raw drag-start cursor position if the glyph or point
   * is unavailable (e.g. new point not yet committed).
   */
  private getAnchorPosition(snapshot: Glyph | null, pointId: PointId, fallback: Point2D): Point2D {
    if (!snapshot) return fallback;
    for (const contour of snapshot.contours) {
      const point = contour.points.find((p) => p.id === pointId);
      if (point) return { x: point.x, y: point.y };
    }
    return fallback;
  }

  /**
   * Determines the reference point used for angle snapping.
   *
   * For anchor (on-curve) points, the reference is the drag-start position
   * itself. For control (off-curve) points, it walks the contour neighbors
   * to find the parent anchor so that angle snapping measures the
   * handle-to-anchor angle rather than an arbitrary direction.
   */
  private resolveSnapReference(
    snapshot: Glyph | null,
    pointId: PointId,
    fallback: Point2D,
  ): Point2D {
    if (!snapshot) return fallback;

    for (const contour of snapshot.contours) {
      const idx = Contours.findPointIndex(contour, pointId);
      if (idx === -1) continue;

      const point = contour.points[idx];
      if (Validate.isOnCurve(point)) {
        return fallback;
      }

      const { prev, next } = Contours.neighbors(contour, idx);
      if (!prev || !next) continue;

      if (Validate.isOffCurve(next) && Validate.isOnCurve(prev)) {
        return { x: prev.x, y: prev.y };
      }
      if (Validate.isOnCurve(next)) {
        return { x: next.x, y: next.y };
      }
      if (Validate.isOnCurve(prev)) {
        return { x: prev.x, y: prev.y };
      }

      return fallback;
    }

    return fallback;
  }
}
