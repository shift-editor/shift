import type { GlyphSnapshot, PointId, AnchorId } from "@shift/types";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export interface GlyphDraft {
  readonly base: GlyphSnapshot;
  change(next: GlyphSnapshot): void;
  finish(label: string): void;
  discard(): void;
}

/** Patch point/anchor positions on a base glyph snapshot. Pure function — no side effects. */
export function patchPositions(base: GlyphSnapshot, updates: NodePositionUpdateList): GlyphSnapshot {
  if (updates.length === 0) return base;

  const pointUpdatesById = new Map<PointId, { x: number; y: number }>();
  const anchorUpdatesById = new Map<AnchorId, { x: number; y: number }>();

  for (const update of updates) {
    switch (update.node.kind) {
      case "point":
        pointUpdatesById.set(update.node.id, { x: update.x, y: update.y });
        break;
      case "anchor":
        anchorUpdatesById.set(update.node.id, { x: update.x, y: update.y });
        break;
      case "guideline":
        break;
    }
  }

  if (pointUpdatesById.size === 0 && anchorUpdatesById.size === 0) return base;

  return {
    ...base,
    contours:
      pointUpdatesById.size === 0
        ? base.contours
        : base.contours.map((contour) => ({
            ...contour,
            points: contour.points.map((point) => {
              const update = pointUpdatesById.get(point.id);
              if (!update) return point;
              return { ...point, x: update.x, y: update.y };
            }),
          })),
    anchors:
      anchorUpdatesById.size === 0
        ? base.anchors
        : base.anchors.map((anchor) => {
            const update = anchorUpdatesById.get(anchor.id);
            if (!update) return anchor;
            return { ...anchor, x: update.x, y: update.y };
          }),
  };
}
