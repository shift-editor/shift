import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { TextRunNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import { Mat, Rect, type Rect2D } from "@shift/geo";

export class TextRunNodeDefinition extends NodeDefinition<TextRunNode> {
  readonly kind: TextRunNode["kind"] = "textRun";

  readonly #outline = new OutlineRenderer();

  unitsTransform(_node: TextRunNode): Mat {
    return Mat.Scale(1, -1);
  }

  bounds(node: TextRunNode): LocalBounds | null {
    const local = this.#localBounds(node);
    if (!local) return null;

    return localBounds({
      min: { x: local.left, y: local.top },
      max: { x: local.right, y: local.bottom },
    });
  }

  hit(node: TextRunNode, point: LocalPoint): PointerTarget | null {
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

          const renderModel = this.editor
            .glyphForId(glyph.glyphId)
            ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell);
          if (!renderModel) continue;

          renderModel.trackShape();

          ctx.canvas.save();
          ctx.canvas.translate(
            runBase + glyph.origin.x + glyph.xOffset,
            line.y + glyph.origin.y + glyph.yOffset,
          );
          this.#outline.draw(ctx.canvas, renderModel, {
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
