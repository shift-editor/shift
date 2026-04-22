import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import type { Point2D, PointId, FontMetrics } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import type { Signal } from "@/lib/reactive/signal";
import type { SnapPreferences } from "@/types/editor";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
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
 * Creates snap sessions for drag and rotate operations.
 *
 * Stateless between sessions. Each session freezes snap targets at creation
 * time so the pipeline does not recompute them on every mouse move.
 */
export class SnapManager {
  readonly #$glyph: Signal<Glyph | null>;
  readonly #getMetrics: () => FontMetrics;
  readonly #getPreferences: () => SnapPreferences;
  readonly #screenToUpm: (px: number) => number;
  readonly #runner: SnapPipelineRunner;

  constructor(
    $glyph: Signal<Glyph | null>,
    getMetrics: () => FontMetrics,
    getPreferences: () => SnapPreferences,
    screenToUpm: (px: number) => number,
  ) {
    this.#$glyph = $glyph;
    this.#getMetrics = getMetrics;
    this.#getPreferences = getPreferences;
    this.#screenToUpm = screenToUpm;
    this.#runner = new SnapPipelineRunner();
  }

  createDragSession(config: DragSnapSessionConfig): DragSnapSession {
    const context: SnapContext = { previousSnappedAngle: null };
    const steps: PointSnapStep[] = [
      createPointToPointStep(),
      createMetricsStep(),
      createAngleStep(),
    ];
    const query: SnappableQuery = {
      include: ["points", "metrics"],
    };

    if (config.excludedPointIds) {
      query.excludedPointIds = config.excludedPointIds;
    }

    const sources = this.#getSnappableObjects(query);

    const glyph = this.#$glyph.peek();
    const anchorPosition = this.#getAnchorPosition(glyph, config.anchorPointId, config.dragStart);
    const reference = this.#resolveSnapReference(glyph, config.anchorPointId, config.dragStart);

    return {
      getAnchorPosition: () => anchorPosition,
      snap: (cursorPoint, modifiers): PointSnapResult => {
        const pointPosition = Vec2.add(anchorPosition, Vec2.sub(cursorPoint, config.dragStart));
        const prefs = this.#getPreferences();

        return this.#runner.runPointPipeline(steps, {
          point: pointPosition,
          reference,
          modifiers,
          context,
          sources,
          preferences: prefs,
          radius: this.#screenToUpm(prefs.pointRadiusPx),
          increment: (prefs.angleIncrementDeg * Math.PI) / 180,
        });
      },
      clear: () => {
        context.previousSnappedAngle = null;
      },
    };
  }

  createRotateSession(): RotateSnapSession {
    const context: SnapContext = { previousSnappedAngle: null };
    const steps: RotateSnapStep[] = [createRotateAngleStep()];

    return {
      snap: (delta, modifiers): RotateSnapResult => {
        const prefs = this.#getPreferences();

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

  #getSnappableObjects(query: SnappableQuery): SnappableObject[] {
    const result: SnappableObject[] = [];

    if (query.include.includes("points")) {
      const excluded = new Set(query.excludedPointIds ?? []);
      const glyph = this.#$glyph.peek();
      if (glyph) {
        for (const point of glyph.allPoints) {
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
      result.push(...collectMetricSources(this.#getMetrics()));
    }

    return result;
  }

  #getAnchorPosition(snapshot: Glyph | null, pointId: PointId, fallback: Point2D): Point2D {
    if (!snapshot) return fallback;
    const result = snapshot.point(pointId);
    if (result) return { x: result.point.x, y: result.point.y };
    return fallback;
  }

  #resolveSnapReference(snapshot: Glyph | null, pointId: PointId, fallback: Point2D): Point2D {
    if (!snapshot) return fallback;

    const found = snapshot.point(pointId);
    if (found) {
      const { point, contour, index: idx } = found;
      if (Validate.isOnCurve(point)) {
        return fallback;
      }

      const { prev, next } = Contours.neighbors(contour, idx);
      if (!prev || !next) return fallback;

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
