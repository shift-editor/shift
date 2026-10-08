import { Vec2, type Point2D } from "@shift/geo";
import type { MetricPositionGuide, PositionGuide } from "../../../../types/positionEdit";
import type { Canvas } from "../Canvas";

/** Draws snap feedback as solid lines with screen-sized crosses on snapped positions. */
export class SnapLines {
  /**
   * Draws guides without retaining feedback or changing geometry.
   *
   * @remarks
   * Direction guides draw from pivot to target, and alignment guides from the
   * stationary point to the aligned position. Metric guides on the same line
   * draw one span across every snapped position on it.
   *
   * @param canvas - Canvas already transformed into the units the guides are measured in.
   * @param guides - Preview feedback for one frame.
   * @param crossings - Positions, such as selection bounds corners, crossed wherever a drawn
   *   alignment line or metric span passes through them.
   */
  draw(canvas: Canvas, guides: readonly PositionGuide[], crossings: readonly Point2D[] = []): void {
    const { color, widthPx, crossSizePx } = canvas.theme.snap;
    const markers = new Map<string, Point2D>();
    const addMarker = (point: Point2D) => markers.set(`${point.x}:${point.y}`, point);

    for (const guide of guides) {
      if (guide.kind !== "direction") continue;

      canvas.line(guide.from, guide.to, color, widthPx);
      addMarker(guide.from);
      addMarker(guide.to);
    }

    const addCrossings = (from: Point2D, to: Point2D) => {
      for (const crossing of crossings) {
        if (liesOnSegment(crossing, from, to)) addMarker(crossing);
      }
    };

    for (const guide of guides) {
      if (guide.kind !== "alignment") continue;

      canvas.line(guide.target, guide.point, color, widthPx);
      addMarker(guide.target);
      addMarker(guide.point);
      addCrossings(guide.target, guide.point);
    }

    for (const span of metricSpans(guides)) {
      if (span.from.x !== span.to.x) canvas.line(span.from, span.to, color, widthPx);
      for (const point of span.points) addMarker(point);
      addCrossings(span.from, span.to);
    }

    const diagonal: Point2D = { x: crossSizePx, y: crossSizePx };
    const antiDiagonal: Point2D = { x: crossSizePx, y: -crossSizePx };
    canvas.withScreenSpace((screen, project) => {
      for (const marker of markers.values()) {
        const cross = project.point(marker);
        screen.line(Vec2.sub(cross, diagonal), Vec2.add(cross, diagonal), color, widthPx);
        screen.line(Vec2.sub(cross, antiDiagonal), Vec2.add(cross, antiDiagonal), color, widthPx);
      }
    });
  }
}

interface MetricSpan {
  readonly from: Point2D;
  readonly to: Point2D;
  readonly points: readonly Point2D[];
}

/** Groups metric guides by line and spans each group from its leftmost to rightmost position. */
function metricSpans(guides: readonly PositionGuide[]): MetricSpan[] {
  const byLine = new Map<number, MetricPositionGuide[]>();
  for (const guide of guides) {
    if (guide.kind !== "metric") continue;

    const line = byLine.get(guide.y);
    if (line) line.push(guide);
    else byLine.set(guide.y, [guide]);
  }

  return [...byLine.entries()].map(([y, line]) => {
    const xs = line.map((guide) => guide.x);
    return {
      from: { x: Math.min(...xs), y },
      to: { x: Math.max(...xs), y },
      points: xs.map((x) => ({ x, y })),
    };
  });
}

/** Font-unit tolerance for a crossing to count as on a guide line. */
const CROSSING_EPSILON = 1e-6;

/** Whether `point` lies on the segment from `from` to `to`, within a tiny tolerance. */
function liesOnSegment(point: Point2D, from: Point2D, to: Point2D): boolean {
  const segment = Vec2.sub(to, from);
  const offset = Vec2.sub(point, from);
  const length = Vec2.len(segment);
  if (length < CROSSING_EPSILON) return Vec2.len(offset) < CROSSING_EPSILON;

  const across = Math.abs(segment.x * offset.y - segment.y * offset.x) / length;
  const along = (segment.x * offset.x + segment.y * offset.y) / length;
  return (
    across < CROSSING_EPSILON && along >= -CROSSING_EPSILON && along <= length + CROSSING_EPSILON
  );
}
