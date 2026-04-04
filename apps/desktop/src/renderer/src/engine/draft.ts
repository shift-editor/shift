import type { GlyphSnapshot, PointId, AnchorId } from "@shift/types";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export interface GlyphDraft {
  readonly base: GlyphSnapshot;
  setPositions(updates: NodePositionUpdateList): void;
  finish(label: string): void;
  discard(): void;
}

/** Patch point/anchor positions on a base glyph snapshot. Pure function — no side effects. */
export function patchPositions(
  base: GlyphSnapshot,
  updates: NodePositionUpdateList,
): GlyphSnapshot {
  if (updates.length === 0) return base;

  const pointUpdates = new Map<PointId, { x: number; y: number }>();
  const anchorUpdates = new Map<AnchorId, { x: number; y: number }>();

  for (const update of updates) {
    switch (update.node.kind) {
      case "point":
        pointUpdates.set(update.node.id, { x: update.x, y: update.y });
        break;
      case "anchor":
        anchorUpdates.set(update.node.id, { x: update.x, y: update.y });
        break;
      case "guideline":
        break;
    }
  }

  if (pointUpdates.size === 0 && anchorUpdates.size === 0) return base;

  const contours =
    pointUpdates.size === 0
      ? base.contours
      : base.contours.map((contour) => {
          const hasUpdates = contour.points.some((p) => pointUpdates.has(p.id));
          if (!hasUpdates) return contour;

          return {
            ...contour,
            points: contour.points.map((point) => {
              const pos = pointUpdates.get(point.id);
              if (!pos) return point;
              return { ...point, x: pos.x, y: pos.y };
            }),
          };
        });

  const anchors =
    anchorUpdates.size === 0
      ? base.anchors
      : base.anchors.map((anchor) => {
          const pos = anchorUpdates.get(anchor.id);
          if (!pos) return anchor;
          return { ...anchor, x: pos.x, y: pos.y };
        });

  return { ...base, contours, anchors };
}
