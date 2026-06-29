import type { GlyphAnchorHit, GlyphHit, GlyphPointHit, GlyphSegmentHit } from "@shift/glyph-state";
import type { GlyphId, NodeId, PointId } from "@shift/types";
import type { NodePoint, ScenePoint } from "./coordinates";
import type { ShiftNode } from "./node";

type GlyphHitTarget<Hit extends GlyphHit> = Hit & {
  readonly nodeId: NodeId;
  readonly glyphId: GlyphId;
  readonly point: NodePoint;
};

export type GlyphPointTarget = GlyphHitTarget<GlyphPointHit>;

export type GlyphAnchorTarget = GlyphHitTarget<GlyphAnchorHit>;

export type GlyphSegmentTarget = GlyphHitTarget<GlyphSegmentHit> & {
  readonly pointIds: readonly PointId[];
};

export type GlyphEditTarget = GlyphPointTarget | GlyphAnchorTarget | GlyphSegmentTarget;

export interface NodeTarget {
  readonly kind: "node";
  readonly node: ShiftNode;
  readonly point: NodePoint;
}

export interface CanvasTarget {
  readonly kind: "canvas";
  readonly point: ScenePoint;
}

export type PointerTarget = CanvasTarget | NodeTarget | GlyphEditTarget;
