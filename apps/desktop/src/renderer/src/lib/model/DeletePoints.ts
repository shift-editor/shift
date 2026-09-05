import { Curve, type CurveType } from "@shift/geo";
import { Point, type Contour, type Segment } from "@shift/glyph-state";
import { mintContourId, mintPointId, type PointId, type PointSeed } from "@shift/types";
import type { DeleteMode } from "@/types/glyph";
import type { GlyphLayer } from "./Glyph";

/** Groups one contour-aware point deletion into an atomic layer edit. */
export class DeletePoints {
  readonly #layer: GlyphLayer;
  readonly #selected: ReadonlySet<PointId>;
  readonly #mode: DeleteMode;

  /**
   * Captures the selection and policy for one deletion without mutating geometry.
   *
   * @param layer - Authored layer that owns the selected points.
   * @param pointIds - Explicit selected identities, copied for this operation.
   * @param mode - Fit original spans or leave gaps between surviving endpoints.
   */
  constructor(layer: GlyphLayer, pointIds: readonly PointId[], mode: DeleteMode) {
    this.#layer = layer;
    this.#selected = new Set(pointIds);
    this.#mode = mode;
  }

  /**
   * Applies deletion against the layer's original contours in one transaction.
   *
   * @returns Whether a nonempty selection containing only current points was processed.
   * @throws {Error} When contour traversal, fitting, or mutation fails; the transaction rolls back.
   */
  apply(): boolean {
    if (this.#selected.size === 0 || [...this.#selected].some((id) => !this.#layer.point(id))) {
      return false;
    }

    // Retain the original geometry so adjacent spans never consume earlier fits.
    const contours = this.#layer.contours;
    return this.#layer.transaction("Delete selection", () => {
      for (const contour of contours) {
        const points = contour.points;
        if (!points.some((point) => this.#selected.has(point.id))) continue;

        const anchors = points.filter(Point.isOnCurve);
        const surviving = anchors.filter((point) => !this.#selected.has(point.id));
        if (surviving.length === 0) {
          this.#layer.removePoints(points.map((point) => point.id));
          continue;
        }

        const segments = contour.segments();
        if (surviving.length === anchors.length) {
          this.#removeSelectedHandles(segments);
          continue;
        }

        const seeds = new Map<PointId, PointSeed>(
          points.map((point) => [
            point.id,
            {
              id: point.id,
              x: point.x,
              y: point.y,
              pointType: point.pointType,
              smooth: point.smooth,
            },
          ]),
        );
        const fragments = this.#buildSurvivingFragments(contour, surviving, seeds, segments);
        const closed = contour.closed && this.#mode === "fit" && surviving.length > 1;
        this.#replaceContourWithFragments(contour, surviving[0].id, fragments, closed);
      }

      return true;
    });
  }

  #removeSelectedHandles(segments: readonly Segment[]): void {
    const removed = segments.flatMap((segment) => {
      const controls = segment.flatPoints.filter(Point.isOffCurve);
      return controls.some((point) => this.#selected.has(point.id))
        ? controls.map((point) => point.id)
        : [];
    });
    this.#layer.removePoints(removed);
  }

  #collectSpan(byStart: ReadonlyMap<PointId, Segment>, start: PointId, end: PointId): Segment[] {
    const span: Segment[] = [];
    let cursor = start;

    while (cursor !== end) {
      const segment = byStart.get(cursor);
      if (!segment || span.length >= byStart.size) {
        throw new Error("Cannot delete points from an incomplete contour span");
      }

      span.push(segment);
      cursor = segment.endId;
    }

    return span;
  }

  #buildSurvivingFragments(
    contour: Contour,
    surviving: readonly Point[],
    seeds: ReadonlyMap<PointId, PointSeed>,
    segments: readonly Segment[],
  ): PointSeed[][] {
    if (surviving.length === 1) return [[seeds.get(surviving[0].id)!]];

    const byStart = new Map(segments.map((segment) => [segment.startId, segment]));
    const edges: (readonly PointSeed[] | null)[] = [];
    const edgeCount = contour.closed ? surviving.length : surviving.length - 1;

    for (let index = 0; index < edgeCount; index++) {
      const start = surviving[index];
      const end = surviving[(index + 1) % surviving.length];
      const span = this.#collectSpan(byStart, start.id, end.id);

      if (span.length === 1) {
        const controls = span[0].flatPoints.filter(Point.isOffCurve);
        edges.push(
          controls.some((point) => this.#selected.has(point.id))
            ? []
            : controls.map((point) => seeds.get(point.id)!),
        );
        continue;
      }

      switch (this.#mode) {
        case "gap":
          edges.push(null);
          break;
        case "fit": {
          const curves: CurveType[] = span.map((segment) => segment.toCurve());
          const fitted = Curve.fitCubic(curves);
          edges.push(
            [fitted.c0, fitted.c1].map((position) => ({
              id: mintPointId(),
              x: position.x,
              y: position.y,
              pointType: "offCurve",
              smooth: false,
            })),
          );
          break;
        }
      }
    }

    const fragments: PointSeed[][] = [];
    const gap = edges.indexOf(null);
    // Start after a cut so a closed contour's wrapped surviving run stays together.
    const startIndex = contour.closed && gap >= 0 ? (gap + 1) % surviving.length : 0;
    let fragment = [seeds.get(surviving[startIndex].id)!];
    for (let offset = 0; offset < edgeCount; offset++) {
      const index = (startIndex + offset) % surviving.length;
      const controls = edges[index];
      const end = seeds.get(surviving[(index + 1) % surviving.length].id)!;
      const wraps = contour.closed && offset === edgeCount - 1;
      if (controls === null) {
        fragments.push(fragment);
        fragment = wraps ? [] : [end];
        continue;
      }

      fragment.push(...controls);
      if (!wraps) fragment.push(end);
    }
    if (fragment.length > 0) fragments.push(fragment);

    return fragments;
  }

  #replaceContourWithFragments(
    contour: Contour,
    pivot: PointId,
    fragments: readonly (readonly PointSeed[])[],
    closed: boolean,
  ): void {
    // Keep the pivot in place: raw removal prunes a contour when its last point
    // disappears. Reinsert surviving IDs and mint only additional contour IDs.
    const retained = fragments.find((fragment) => fragment.some((point) => point.id === pivot))!;
    const pivotIndex = retained.findIndex((point) => point.id === pivot);
    this.#layer.removePoints(
      contour.points.filter((point) => point.id !== pivot).map((point) => point.id),
    );
    this.#layer.addPointSeeds(contour.id, retained.slice(0, pivotIndex), pivot);
    this.#layer.addPointSeeds(contour.id, retained.slice(pivotIndex + 1));
    if (closed) this.#layer.closeContour(contour.id);
    else this.#layer.openContour(contour.id);

    for (const fragment of fragments) {
      if (fragment === retained) continue;

      const contourId = mintContourId();
      this.#layer.addContourSeed(contourId, false);
      this.#layer.addPointSeeds(contourId, fragment);
    }
  }
}
