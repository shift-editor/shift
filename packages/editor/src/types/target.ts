import type { GlyphAnchorHit, GlyphHit, GlyphPointHit, GlyphSegmentHit } from "@shift/glyph-state";
import type { AnchorId, ComponentId, GlyphId, NodeId, PointId } from "@shift/types";
import type { LocalPoint, ScenePoint } from "./coordinates";
import type { ShiftNode } from "./node";

type GlyphHitTarget<Hit extends GlyphHit> = Hit & {
  readonly nodeId: NodeId;
  readonly glyphId: GlyphId;
  readonly point: LocalPoint;
};

export type GlyphPointTarget = GlyphHitTarget<GlyphPointHit> & {
  readonly pointId: PointId;
};

export type GlyphAnchorTarget = GlyphHitTarget<GlyphAnchorHit> & {
  readonly anchorId: AnchorId;
};

export type GlyphSegmentTarget = GlyphHitTarget<GlyphSegmentHit> & {
  readonly segmentId: GlyphSegmentHit["id"];
  readonly pointIds: readonly PointId[];
};

export interface GlyphComponentTarget {
  readonly kind: "component";
  readonly id: ComponentId;
  readonly componentId: ComponentId;
  readonly componentPath: readonly ComponentId[];
  readonly nodeId: NodeId;
  readonly glyphId: GlyphId;
  readonly point: LocalPoint;
}

export type GlyphEditTarget =
  | GlyphPointTarget
  | GlyphAnchorTarget
  | GlyphSegmentTarget
  | GlyphComponentTarget;

export interface NodeTarget {
  readonly kind: "node";
  readonly node: ShiftNode;
  readonly point: LocalPoint;
}

export interface CanvasTarget {
  readonly kind: "canvas";
  readonly point: ScenePoint;
}

export type PointerTarget = CanvasTarget | NodeTarget | GlyphEditTarget;
