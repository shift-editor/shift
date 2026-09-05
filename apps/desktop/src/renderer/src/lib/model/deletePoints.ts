import { Curve, type CurveType } from "@shift/geo";
import { Point, type Segment } from "@shift/glyph-state";
import { mintContourId, mintPointId, type PointId, type PointSeed } from "@shift/types";
import type { DeleteMode } from "@/types/glyph";
import type { GlyphLayer } from "./Glyph";

export function deletePoints(
  layer: GlyphLayer,
  pointIds: readonly PointId[],
  mode: DeleteMode,
): boolean {
  const selected = new Set(pointIds);
  if (selected.size === 0 || [...selected].some((id) => !layer.point(id))) return false;

  // Freeze all source geometry before any mutation. Every affected span is
  // fitted once, regardless of selection insertion order or overlapping handles.
  const contours = layer.contours;
  return layer.transaction("Delete selection", () => {
    for (const contour of contours) {
      const points = contour.points;
      if (!points.some((point) => selected.has(point.id))) continue;

      const anchors = points.filter(Point.isOnCurve);
      const surviving = anchors.filter((point) => !selected.has(point.id));
      if (surviving.length === 0) {
        layer.removePoints(points.map((point) => point.id));
        continue;
      }

      const segments = contour.segments();
      if (surviving.length === anchors.length) {
        const removed = segments.flatMap((segment) => {
          const controls = segment.flatPoints.filter(Point.isOffCurve);
          return controls.some((point) => selected.has(point.id))
            ? controls.map((point) => point.id)
            : [];
        });
        layer.removePoints(removed);
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
      const fragments: PointSeed[][] = [];
      let closed = contour.closed && mode === "fit" && surviving.length > 1;

      if (surviving.length === 1) {
        fragments.push([seeds.get(surviving[0].id)!]);
      } else {
        const byStart = new Map(segments.map((segment) => [segment.startId, segment]));
        const edges: (readonly PointSeed[] | null)[] = [];
        const edgeCount = contour.closed ? surviving.length : surviving.length - 1;

        for (let index = 0; index < edgeCount; index++) {
          const start = surviving[index];
          const end = surviving[(index + 1) % surviving.length];
          const span: Segment[] = [];
          let cursor = start.id;
          while (cursor !== end.id) {
            const segment = byStart.get(cursor);
            if (!segment || span.length >= segments.length) {
              throw new Error("Cannot delete points from an incomplete contour span");
            }
            span.push(segment);
            cursor = segment.endId;
          }

          if (span.length === 1) {
            const controls = span[0].flatPoints.filter(Point.isOffCurve);
            edges.push(
              controls.some((point) => selected.has(point.id))
                ? []
                : controls.map((point) => seeds.get(point.id)!),
            );
            continue;
          }

          switch (mode) {
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

        const gap = edges.indexOf(null);
        // A closed path with a gap starts immediately after a cut, not at the
        // array's arbitrary start point. This joins the wrapped surviving run.
        const startIndex = contour.closed && gap >= 0 ? (gap + 1) % surviving.length : 0;
        closed = contour.closed && gap < 0;
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
      }

      // Keep one surviving point in the original contour throughout the batch:
      // raw removal prunes empty contours. Reinsert the other original IDs in
      // their resulting order, and mint identities only for genuinely new items.
      const pivot = surviving[0].id;
      const retained = fragments.find((fragment) => fragment.some((point) => point.id === pivot))!;
      const pivotIndex = retained.findIndex((point) => point.id === pivot);
      layer.removePoints(points.filter((point) => point.id !== pivot).map((point) => point.id));
      layer.addPointSeeds(contour.id, retained.slice(0, pivotIndex), pivot);
      layer.addPointSeeds(contour.id, retained.slice(pivotIndex + 1));
      if (closed) layer.closeContour(contour.id);
      else layer.openContour(contour.id);

      for (const fragment of fragments) {
        if (fragment === retained) continue;

        const contourId = mintContourId();
        layer.addContourSeed(contourId, false);
        layer.addPointSeeds(contourId, fragment);
      }
    }
    return true;
  });
}
