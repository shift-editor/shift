import type { Rect2D } from "@shift/geo";
import type { NodePoint } from "@/types/coordinates";
import { NodeDefinition } from "@/lib/nodes/NodeDefinition";
import type { GlyphNode } from "@/types/node";
import type { PointerTarget } from "@/types/target";

export class GlyphNodeDefinition extends NodeDefinition<GlyphNode> {
  readonly kind: GlyphNode["kind"] = "glyph";

  bounds(_node: GlyphNode): Rect2D | null {
    return null;
  }

  hit(node: GlyphNode, point: NodePoint): PointerTarget | null {
    const instance = this.editor.font.instance(node.glyphId, this.editor.designLocationCell);
    if (!instance) return null;

    const hit = instance.geometry.hitAt(point, this.editor.hitRadius);
    if (!hit) return null;

    switch (hit.kind) {
      case "segment": {
        const segment = instance.geometry.segment(hit.id);
        if (!segment) return null;

        return {
          ...hit,
          nodeId: node.id,
          glyphId: node.glyphId,
          point,
          segmentId: hit.id,
          pointIds: segment.pointIds,
        };
      }

      case "point":
        return {
          ...hit,
          nodeId: node.id,
          glyphId: node.glyphId,
          point,
          pointId: hit.id,
        };

      case "anchor":
        return {
          ...hit,
          nodeId: node.id,
          glyphId: node.glyphId,
          point,
          anchorId: hit.id,
        };
    }
  }
}
