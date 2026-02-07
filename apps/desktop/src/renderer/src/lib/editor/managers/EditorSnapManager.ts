import { Vec2 } from "@shift/geo";
import { Contours, Glyphs } from "@shift/font";
import { Validate } from "@shift/validation";
import type { Glyph, Point2D, PointId } from "@shift/types";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  EditorSnapManagerDeps,
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

export class EditorSnapManager {
  readonly #deps: EditorSnapManagerDeps;
  readonly #runner: SnapPipelineRunner;

  constructor(deps: EditorSnapManagerDeps) {
    this.#deps = deps;
    this.#runner = new SnapPipelineRunner();
  }

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
        const prefs = this.#deps.getPreferences();

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

  createRotateSession(): RotateSnapSession {
    const context: SnapContext = { previousSnappedAngle: null };
    const steps: RotateSnapStep[] = [createRotateAngleStep()];

    return {
      snap: (delta, modifiers): RotateSnapResult => {
        const prefs = this.#deps.getPreferences();

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

  private getAnchorPosition(snapshot: Glyph | null, pointId: PointId, fallback: Point2D): Point2D {
    if (!snapshot) return fallback;
    for (const contour of snapshot.contours) {
      const point = contour.points.find((p) => p.id === pointId);
      if (point) return { x: point.x, y: point.y };
    }
    return fallback;
  }

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
