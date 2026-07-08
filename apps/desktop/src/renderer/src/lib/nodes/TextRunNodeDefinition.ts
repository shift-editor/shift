import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "@/lib/editor/rendering/Outline";
import type { NodePoint } from "@/types/coordinates";
import type { TextRunNode } from "@/types/node";
import type { RenderContext, RenderPass } from "@/types/rendering";
import type { PointerTarget } from "@/types/target";
import { Rect, type Rect2D } from "@shift/geo";

export class TextRunNodeDefinition extends NodeDefinition<TextRunNode> {
  readonly kind: TextRunNode["kind"] = "textRun";

  readonly #outline = new OutlineRenderer();

  bounds(node: TextRunNode): Rect2D | null {
    const local = this.#localBounds(node);
    if (!local) return null;

    return {
      x: local.x + node.position.x,
      y: local.y + node.position.y,
      width: local.width,
      height: local.height,
      left: local.left + node.position.x,
      top: local.top + node.position.y,
      right: local.right + node.position.x,
      bottom: local.bottom + node.position.y,
    };
  }

  hit(node: TextRunNode, point: NodePoint): PointerTarget | null {
    const bounds = this.#localBounds(node);
    if (!bounds || !Rect.containsPoint(bounds, point)) return null;

    return { kind: "node", node, point };
  }

  draw(node: TextRunNode, ctx: RenderContext, pass: RenderPass): void {
    if (pass !== "content") return;

    const layout = this.editor.text.layoutForNode(node);
    if (!layout) return;

    for (const line of layout.lines) {
      let runBase = layout.origin.x;

      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (!glyph.glyphId) continue;

          const instance = this.editor.font.instance(glyph.glyphId, this.editor.designLocationCell);
          if (!instance) continue;

          instance.render.trackShape();

          ctx.canvas.save();
          ctx.canvas.translate(
            runBase + glyph.origin.x + glyph.xOffset,
            line.y + glyph.origin.y + glyph.yOffset,
          );
          this.#outline.draw(ctx.canvas, instance.render.outline, {
            fill: ctx.canvas.theme.glyph.fill,
          });
          ctx.canvas.restore();
        }

        runBase += run.advance;
      }
    }
  }

  #localBounds(node: TextRunNode): Rect2D | null {
    const layout = this.editor.text.layoutForNode(node);
    if (!layout) return null;

    let right = 0;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const line of layout.lines) {
      let lineAdvance = 0;
      for (const run of line.runs) lineAdvance += run.advance;

      right = Math.max(right, layout.origin.x + lineAdvance);
      top = Math.min(top, line.y + line.descent);
      bottom = Math.max(bottom, line.y + line.ascent);
    }

    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;

    return {
      x: 0,
      y: top,
      width: right,
      height: bottom - top,
      left: 0,
      top,
      right,
      bottom,
    };
  }
}
