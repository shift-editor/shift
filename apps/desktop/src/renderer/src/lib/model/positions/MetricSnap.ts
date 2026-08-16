import type { Point2D } from "@shift/geo";
import type { SourceMetrics } from "@shift/types";
import type {
  MetricPositionGuide,
  PositionCondition,
  PositionSnap,
  PositionSnapProvider,
} from "@/types/positionEdit";

/** Snaps a position's Y coordinate to standard source-specific horizontal metrics. */
export class MetricSnap implements PositionSnapProvider {
  readonly #guides: readonly MetricPositionGuide[];
  readonly #radius: number;
  readonly #when: () => boolean;

  private constructor(
    guides: readonly MetricPositionGuide[],
    radius: number,
    condition?: PositionCondition,
  ) {
    this.#guides = guides;
    this.#radius = radius;
    this.#when = condition?.when ?? (() => true);
  }

  static standard(
    metrics: SourceMetrics,
    radius: number,
    condition?: PositionCondition,
  ): MetricSnap {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error("Metric snap radius must be a non-negative finite number");
    }

    const guides: MetricPositionGuide[] = [
      { kind: "metric", metric: "baseline", y: metrics.baseline },
      { kind: "metric", metric: "ascender", y: metrics.ascender },
      { kind: "metric", metric: "descender", y: metrics.descender },
    ];

    if (metrics.xHeight !== undefined) {
      guides.push({ kind: "metric", metric: "xHeight", y: metrics.xHeight });
    }
    if (metrics.capHeight !== undefined) {
      guides.push({ kind: "metric", metric: "capHeight", y: metrics.capHeight });
    }

    return new MetricSnap(uniqueMetricGuides(guides), radius, condition);
  }

  snap(point: Point2D): PositionSnap | null {
    if (!this.#when()) return null;

    let best: { guide: MetricPositionGuide; distance: number } | null = null;

    for (const guide of this.#guides) {
      const distance = Math.abs(point.y - guide.y);
      if (distance > this.#radius) continue;
      if (best && best.distance <= distance) continue;

      best = { guide, distance };
    }

    if (!best) return null;

    return {
      point: { x: point.x, y: best.guide.y },
      distance: best.distance,
      guides: [best.guide],
    };
  }
}

function uniqueMetricGuides(guides: readonly MetricPositionGuide[]): MetricPositionGuide[] {
  const positions = new Set<number>();
  const unique: MetricPositionGuide[] = [];

  for (const guide of guides) {
    if (positions.has(guide.y)) continue;

    positions.add(guide.y);
    unique.push(guide);
  }

  return unique;
}
