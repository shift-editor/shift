import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type TextLayout } from "../text/layout";
import { clusterForCaret } from "../text/edit";
import type { NodePoint } from "../../types/coordinates";
import type { TextRunNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import type { Rect2D } from "@shift/geo";

/** Projects one shared proof run through a placed, scaled scene node. */
export class TextRunNodeDefinition extends NodeDefinition<TextRunNode> {
  readonly kind: TextRunNode["kind"] = "textRun";
  readonly #outline = new OutlineRenderer();

  bounds(node: TextRunNode): Rect2D | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;
    const scale = this.#scale(node);
    const lines = layout.lines;
    const bottom = lines.length
      ? lines[lines.length - 1]!.y + lines[lines.length - 1]!.descent
      : layout.metrics.descender;
    const top = layout.metrics.ascender;
    const width = Math.max(
      1,
      ...lines.map((line) => line.runs.reduce((advance, run) => advance + run.advance, 0)),
    );
    return {
      x: node.position.x,
      y: node.position.y + bottom * scale,
      width: width * scale,
      height: (top - bottom) * scale,
      left: node.position.x,
      right: node.position.x + width * scale,
      top: node.position.y + bottom * scale,
      bottom: node.position.y + top * scale,
    };
  }

  hit(node: TextRunNode, point: NodePoint): PointerTarget | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    const run = this.editor.text.run(node.runId);
    if (!layout || !run) return null;
    const scale = this.#scale(node);
    const local = { x: point.x / scale, y: point.y / scale };
    const hit = layout.hitTest(local);
    if (hit) {
      return {
        kind: "text",
        node,
        point,
        cluster: hit.cluster + (hit.side === "right" ? 1 : 0),
        itemId: run.items[hit.cluster]?.id ?? null,
      };
    }
    // Leave blank canvas alone; accept a narrow strip at the line end or an empty caret.
    const padding = this.editor.hitRadius / scale;
    for (const line of layout.lines) {
      if (local.y < line.y + line.descent - padding || local.y > line.y + line.ascent + padding)
        continue;
      const advance = line.runs.reduce((sum, part) => sum + part.advance, 0);
      if (local.x < -padding || local.x > advance + padding) continue;
      return {
        kind: "text",
        node,
        point,
        cluster: local.x <= 0 ? line.clusterStart : line.clusterEnd - 1,
        itemId: null,
      };
    }
    if (
      run.items.length === 0 &&
      Math.abs(local.x) <= padding &&
      local.y >= layout.metrics.descender - padding &&
      local.y <= layout.metrics.ascender + padding
    ) {
      return { kind: "text", node, point, cluster: 0, itemId: null };
    }
    return null;
  }

  draw(node: TextRunNode, ctx: RenderContext, pass: RenderPass): void {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return;
    const scale = this.#scale(node);
    ctx.canvas.ctx.save();
    ctx.canvas.ctx.scale(scale, scale);
    try {
      switch (pass) {
        case "background": {
          const editing = this.editor.textEditing.stateCell.peek();
          if (editing?.nodeId !== node.id) break;
          for (const rect of this.editor.textEditing.selectionRects) {
            ctx.canvas.fillRect(
              rect.x,
              rect.bottom,
              rect.width,
              rect.top - rect.bottom,
              ctx.canvas.theme.textRun.selectionFill,
            );
          }
          break;
        }
        case "content":
          this.#drawGlyphs(node, ctx, layout);
          break;
        case "controls": {
          const editing = this.editor.textEditing.stateCell.peek();
          const run = this.editor.text.run(node.runId);
          if (editing?.nodeId !== node.id || !run) break;
          const caret = Caret.atCluster(
            layout,
            clusterForCaret(run.items, editing.focus),
          ).position();
          ctx.canvas.line(
            { x: caret.x, y: caret.y + layout.metrics.descender },
            { x: caret.x, y: caret.y + layout.metrics.ascender },
            ctx.canvas.theme.textRun.cursorColor,
            ctx.canvas.theme.textRun.cursorWidthPx / scale,
          );
          break;
        }
        case "overlay":
          break;
      }
    } finally {
      ctx.canvas.ctx.restore();
    }
  }

  #drawGlyphs(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const hovered = this.editor.textEditing.hoveredItemCell.peek();
    const active = this.editor.textEditing.stateCell.peek()?.nodeId === node.id;
    let runBase: number;
    for (const line of layout.lines) {
      runBase = layout.origin.x;
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (!glyph.glyphId) continue;
          const renderModel = this.editor
            .glyphForId(glyph.glyphId)
            ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell);
          if (!renderModel) continue;
          renderModel.trackShape();
          ctx.canvas.ctx.save();
          ctx.canvas.ctx.translate(
            runBase + glyph.origin.x + glyph.xOffset,
            line.y + glyph.origin.y + glyph.yOffset,
          );
          this.#outline.draw(ctx.canvas, renderModel, {
            fill: ctx.canvas.theme.glyph.fill,
            ...(active && hovered && glyph.sourceItemIds.includes(hovered)
              ? {
                  stroke: {
                    color: ctx.canvas.theme.textRun.hoverOutline,
                    widthPx: ctx.canvas.theme.textRun.hoverOutlineWidthPx / this.#scale(node),
                  },
                }
              : {}),
          });
          ctx.canvas.ctx.restore();
        }
        runBase += run.advance;
      }
    }
  }

  #scale(node: TextRunNode): number {
    return node.size / this.editor.font.metricsCell.peek().unitsPerEm;
  }
}
