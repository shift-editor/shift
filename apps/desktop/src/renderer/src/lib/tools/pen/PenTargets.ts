import type { Point2D } from "@shift/geo";
import { Point, type SegmentId } from "@shift/glyph-state";
import type { ContourId, PointId } from "@shift/types";
import type { GlyphGeometry } from "@/lib/model/Glyph";

export type PenTarget =
  | {
      readonly type: "terminal";
      readonly contourId: ContourId;
      readonly pointId: PointId;
      readonly side: "start" | "end";
    }
  | {
      readonly type: "segment";
      readonly segmentId: SegmentId;
      readonly t: number;
    }
  | { readonly type: "empty" };

export class PenTargets {
  readonly #geometry: GlyphGeometry;

  private constructor(geometry: GlyphGeometry) {
    this.#geometry = geometry;
  }

  static forGeometry(geometry: GlyphGeometry): PenTargets {
    return new PenTargets(geometry);
  }

  at(pos: Point2D, radius: number): PenTarget {
    const terminal = this.#hitOpenTerminal(pos, radius);
    if (terminal) return terminal;

    const segment = this.#geometry.hitSegment(pos, radius);
    if (segment) {
      return {
        type: "segment",
        segmentId: segment.id,
        t: segment.t,
      };
    }

    return { type: "empty" };
  }

  #hitOpenTerminal(pos: Point2D, radius: number): PenTarget | null {
    let best: (PenTarget & { readonly type: "terminal"; readonly distance: number }) | null = null;

    for (const contour of this.#geometry.contours) {
      if (contour.closed) continue;

      const first = contour.firstPoint;
      if (!first) continue;

      const firstHit = Point.hit(first, pos, radius);
      if (firstHit && (!best || firstHit.distance < best.distance)) {
        best = {
          type: "terminal",
          contourId: contour.id,
          pointId: first.id,
          side: "start",
          distance: firstHit.distance,
        };
      }

      const last = contour.lastPoint;
      if (!last) continue;

      const lastHit = Point.hit(last, pos, radius);
      if (lastHit && (!best || lastHit.distance < best.distance)) {
        best = {
          type: "terminal",
          contourId: contour.id,
          pointId: last.id,
          side: "end",
          distance: lastHit.distance,
        };
      }
    }

    if (!best) return null;
    const { distance: _distance, ...target } = best;
    return target;
  }
}
