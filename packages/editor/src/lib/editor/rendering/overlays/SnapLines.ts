import { Vec2, type Point2D } from "@shift/geo";
import { ascending, comparing } from "@shift/types";
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
    const feedback = snapFeedback(guides, crossings);
    for (const [from, to] of feedback.lines) canvas.line(from, to, color, widthPx);

    const diagonal: Point2D = { x: crossSizePx, y: crossSizePx };
    const antiDiagonal: Point2D = { x: crossSizePx, y: -crossSizePx };
    canvas.withScreenSpace((screen, project) => {
      for (const marker of feedback.markers) {
        const cross = project.point(marker);
        screen.line(Vec2.sub(cross, diagonal), Vec2.add(cross, diagonal), color, widthPx);
        screen.line(Vec2.sub(cross, antiDiagonal), Vec2.add(cross, antiDiagonal), color, widthPx);
      }
    });
  }
}

/** What one frame's snap feedback draws, in the units the guides are measured in. */
export interface SnapFeedback {
  /** Each distinct guide line once, from its start to its end. */
  readonly lines: readonly (readonly [Point2D, Point2D])[];
  /** Each position that gets a cross once, in no particular order: guide ends, snapped positions and crossings. */
  readonly markers: readonly Point2D[];
}

/**
 * The lines and crosses that show `guides`; see {@link SnapLines.draw}.
 *
 * @remarks
 * A dragged group yields many guides, often the same line again, and a large
 * glyph has thousands of crossings, so each distinct line is drawn and tested
 * once, and a horizontal or vertical one looks only at the crossings on its
 * coordinate.
 */
export function snapFeedback(
  guides: readonly PositionGuide[],
  crossings: readonly Point2D[] = [],
): SnapFeedback {
  const lines = new Map<string, readonly [Point2D, Point2D]>();
  const markers = new Map<string, Point2D>();
  const crossed = new Set<string>();
  const index = new CrossingIndex(crossings);
  const addLine = (from: Point2D, to: Point2D) => {
    const key = lineKey(from, to);
    if (!lines.has(key)) lines.set(key, [from, to]);
  };
  const addMarker = (point: Point2D) => markers.set(`${point.x}:${point.y}`, point);
  const addCrossings = (from: Point2D, to: Point2D) => {
    const key = lineKey(from, to);
    if (crossed.has(key)) return;
    crossed.add(key);
    for (const crossing of index.on(from, to)) addMarker(crossing);
  };

  for (const guide of guides) {
    if (guide.kind !== "direction") continue;

    addLine(guide.from, guide.to);
    addMarker(guide.from);
    addMarker(guide.to);
  }

  for (const guide of guides) {
    if (guide.kind !== "alignment") continue;

    addLine(guide.target, guide.point);
    addMarker(guide.target);
    addMarker(guide.point);
    addCrossings(guide.target, guide.point);
  }

  for (const span of metricSpans(guides)) {
    if (span.from.x !== span.to.x) addLine(span.from, span.to);
    for (const point of span.points) addMarker(point);
    addCrossings(span.from, span.to);
  }

  return { lines: [...lines.values()], markers: [...markers.values()] };
}

function lineKey(from: Point2D, to: Point2D): string {
  return `${from.x}:${from.y}:${to.x}:${to.y}`;
}

/**
 * Crossings sorted along each axis, so a horizontal or vertical line tests only
 * the crossings near its coordinate; any other line tests them all.
 */
class CrossingIndex {
  readonly #crossings: readonly Point2D[];
  #byX: readonly Point2D[] | null = null;
  #byY: readonly Point2D[] | null = null;

  constructor(crossings: readonly Point2D[]) {
    this.#crossings = crossings;
  }

  /** The crossings on the segment from `from` to `to`, as {@link liesOnSegment} decides. */
  on(from: Point2D, to: Point2D): Point2D[] {
    return this.#near(from, to).filter((crossing) => liesOnSegment(crossing, from, to));
  }

  /** The crossings that can lie on the segment: those near its line when it is axis-aligned. */
  #near(from: Point2D, to: Point2D): readonly Point2D[] {
    if (from.x === to.x) {
      this.#byX ??= this.#sorted("x");
      return nearOnAxis(this.#byX, "x", from.x);
    }
    if (from.y === to.y) {
      this.#byY ??= this.#sorted("y");
      return nearOnAxis(this.#byY, "y", from.y);
    }
    return this.#crossings;
  }

  #sorted(axis: "x" | "y"): readonly Point2D[] {
    return this.#crossings.toSorted(comparing((point: Point2D) => point[axis], ascending));
  }
}

/**
 * The points of `sorted` whose `axis` coordinate is within twice
 * {@link CROSSING_EPSILON} of `value`: a superset of those a horizontal or
 * vertical segment there can pass through.
 */
function nearOnAxis(sorted: readonly Point2D[], axis: "x" | "y", value: number): Point2D[] {
  const min = value - 2 * CROSSING_EPSILON;
  const max = value + 2 * CROSSING_EPSILON;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]![axis] < min) low = middle + 1;
    else high = middle;
  }

  const near: Point2D[] = [];
  for (let slot = low; slot < sorted.length && sorted[slot]![axis] <= max; slot++) {
    near.push(sorted[slot]!);
  }
  return near;
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

  return byLine
    .entries()
    .map(([y, line]) => {
      const xs = line.map((guide) => guide.x);
      return {
        from: { x: Math.min(...xs), y },
        to: { x: Math.max(...xs), y },
        points: xs.map((x) => ({ x, y })),
      };
    })
    .toArray();
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
