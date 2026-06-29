import type { Point2D } from "@shift/geo";
import type { GlyphId, NodeId, SourceId } from "@shift/types";

export interface Node {
  id: NodeId;
  kind: string;
  position: Point2D;
}

export interface GlyphNode extends Node {
  readonly kind: "glyph";
  readonly glyphId: GlyphId;
  readonly sourceId: SourceId;
}

export type ShiftNode = GlyphNode;
