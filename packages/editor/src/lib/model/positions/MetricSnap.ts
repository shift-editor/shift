import type { Point2D } from "@shift/geo";
import type { SourceMetrics } from "@shift/types";
import type {
  MetricPositionGuide,
  PositionCondition,
  PositionSnap,
  PositionSnapProvider,
} from "../../../types/positionEdit";

/** Glyph-local horizontal span the metric lines are drawn across. */
export interface MetricExtent {
  readonly minX: number;
  readonly maxX: number;
}

/** A standard horizontal metric line, independent of any snapped position. */
export type MetricLine = Omit<MetricPositionGuide, "x">;

/**
 * Lists the standard horizontal metric lines a source authors, one per distinct height.
 *
 * @remarks
 * Absent optional metrics are left out rather than placed at zero. When two
 * metrics share a height, the first in baseline, ascender, descender, x-height,
 * cap-height order names the line.
 */
export function standardMetricLines(metrics: SourceMetrics): MetricLine[] {
  const lines: MetricLine[] = [
    { kind: "metric", metric: "baseline", y: metrics.baseline },
    { kind: "metric", metric: "ascender", y: metrics.ascender },
    { kind: "metric", metric: "descender", y: metrics.descender },
  ];

  if (metrics.xHeight !== undefined) {
    lines.push({ kind: "metric", metric: "xHeight", y: metrics.xHeight });
  }
  if (metrics.capHeight !== undefined) {
    lines.push({ kind: "metric", metric: "capHeight", y: metrics.capHeight });
  }

  return uniqueMetricLines(lines);
}

/** Snaps a position's Y coordinate to standard source-specific horizontal metrics. */
export class MetricSnap implements PositionSnapProvider {
  readonly #guides: readonly MetricLine[];
  readonly #radius: number;
  readonly #when: () => boolean;
  readonly #extent: MetricExtent | null;

  private constructor(
    guides: readonly MetricLine[],
    radius: number,
    condition?: PositionCondition,
    extent: MetricExtent | null = null,
  ) {
    this.#guides = guides;
    this.#radius = radius;
    this.#when = condition?.when ?? (() => true);
    this.#extent = extent;
  }

  static standard(
    metrics: SourceMetrics,
    radius: number,
    condition?: PositionCondition,
  ): MetricSnap {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error("Metric snap radius must be a non-negative finite number");
    }

    return new MetricSnap(standardMetricLines(metrics), radius, condition);
  }

  /**
   * Limits snapping to positions over the lines' horizontal extent.
   *
   * @param extent - Glyph-local x range the metric lines span, usually 0 to the advance.
   * @returns A new snap with the same lines, radius, and condition.
   */
  across(extent: MetricExtent): MetricSnap {
    return new MetricSnap(this.#guides, this.#radius, { when: this.#when }, { ...extent });
  }

  snap(point: Point2D): PositionSnap | null {
    if (!this.#when()) return null;
    if (this.#extent && (point.x < this.#extent.minX || point.x > this.#extent.maxX)) {
      return null;
    }

    let best: { guide: MetricLine; distance: number } | null = null;

    for (const guide of this.#guides) {
      const distance = Math.abs(point.y - guide.y);
      if (distance > this.#radius) continue;
      if (best && best.distance <= distance) continue;

      best = { guide, distance };
    }

    if (!best) return null;

    const guide: MetricPositionGuide = { ...best.guide, x: point.x };
    return { x: null, y: { offset: guide.y - point.y, guides: [guide] } };
  }
}

function uniqueMetricLines(lines: readonly MetricLine[]): MetricLine[] {
  const positions = new Set<number>();
  const unique: MetricLine[] = [];

  for (const line of lines) {
    if (positions.has(line.y)) continue;

    positions.add(line.y);
    unique.push(line);
  }

  return unique;
}
