import type {
  GlyphSnapshot,
  PointId,
  AnchorId,
  ContourSnapshot,
  PointSnapshot,
  AnchorSnapshot,
} from "@shift/types";
import type { Point2D } from "@shift/types";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export interface GlyphDraft {
  readonly base: GlyphSnapshot;
  setPositions(updates: NodePositionUpdateList): void;
  finish(label: string): void;
  discard(): void;
}

/**
 * Produce a new glyph snapshot with updated point/anchor positions.
 * Pure function — returns a new snapshot with structural sharing
 * (unchanged contours/points are identity-equal to the originals).
 */
export function produceGlyph(
  base: GlyphSnapshot,
  updates: NodePositionUpdateList,
): GlyphSnapshot {
  if (updates.length === 0) return base;

  const pointMoves = new Map<PointId, Point2D>();
  const anchorMoves = new Map<AnchorId, Point2D>();

  for (const u of updates) {
    switch (u.node.kind) {
      case "point":
        pointMoves.set(u.node.id, u);
        break;
      case "anchor":
        anchorMoves.set(u.node.id, u);
        break;
    }
  }

  if (pointMoves.size === 0 && anchorMoves.size === 0) return base;

  return {
    ...base,
    contours: pointMoves.size === 0 ? base.contours : updateContours(base.contours, pointMoves),
    anchors: anchorMoves.size === 0 ? base.anchors : updateAnchors(base.anchors, anchorMoves),
  };
}

function updateContours(
  contours: ContourSnapshot[],
  moves: ReadonlyMap<PointId, Point2D>,
): ContourSnapshot[] {
  return contours.map((contour) => {
    if (!contour.points.some((p) => moves.has(p.id))) return contour;

    return {
      ...contour,
      points: contour.points.map((point) => applyMove(point, moves.get(point.id))),
    };
  });
}

function updateAnchors(
  anchors: AnchorSnapshot[],
  moves: ReadonlyMap<AnchorId, Point2D>,
): AnchorSnapshot[] {
  return anchors.map((anchor) => {
    const pos = moves.get(anchor.id);
    if (!pos) return anchor;
    return { ...anchor, x: pos.x, y: pos.y };
  });
}

function applyMove(point: PointSnapshot, pos: Point2D | undefined): PointSnapshot {
  if (!pos) return point;
  return { ...point, x: pos.x, y: pos.y };
}
