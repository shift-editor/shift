import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type TextLayout } from "../text/layout";
import { clusterForCaret } from "../text/edit";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { TextRunNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import { Mat } from "@shift/geo";

/** Projects one shared proof run through a placed, scaled scene node. */
export class TextRunNodeDefinition extends NodeDefinition<TextRunNode> {
  readonly kind: TextRunNode["kind"] = "textRun";
  readonly #outline = new OutlineRenderer();

  unitsTransform(node: TextRunNode): Mat {
    const scale = this.#scale(node);
    return Mat.Scale(scale, -scale);
  }

  bounds(node: TextRunNode): LocalBounds | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;

    const lines = layout.lines;
    const lastLine = lines[lines.length - 1];
    const bottom = lastLine ? lastLine.y + lastLine.descent : layout.metrics.descender;
    const top = layout.metrics.ascender;
    const width = Math.max(
      1,
      ...lines.map((line) => line.runs.reduce((advance, run) => advance + run.advance, 0)),
    );

    return localBounds({ min: { x: 0, y: bottom }, max: { x: width, y: top } });
  }

  hit(node: TextRunNode, point: LocalPoint): PointerTarget | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    const run = this.editor.text.run(node.runId);
    if (!layout || !run) return null;

    const hit = layout.hitTest(point);
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
    const padding = this.editor.hitRadius / this.#scale(node);
    for (const line of layout.lines) {
      if (point.y < line.y + line.descent - padding || point.y > line.y + line.ascent + padding)
        continue;
      const advance = line.runs.reduce((sum, part) => sum + part.advance, 0);
      if (point.x < -padding || point.x > advance + padding) continue;
      return {
        kind: "text",
        node,
        point,
        cluster: point.x <= 0 ? line.clusterStart : line.clusterEnd - 1,
        itemId: null,
      };
    }
    if (
      run.items.length === 0 &&
      Math.abs(point.x) <= padding &&
      point.y >= layout.metrics.descender - padding &&
      point.y <= layout.metrics.ascender + padding
    ) {
      return { kind: "text", node, point, cluster: 0, itemId: null };
    }
    return null;
  }

  draw(node: TextRunNode, ctx: RenderContext, pass: RenderPass): void {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return;

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
        const caret = Caret.atCluster(layout, clusterForCaret(run.items, editing.focus)).position();
        ctx.canvas.line(
          { x: caret.x, y: caret.y + layout.metrics.descender },
          { x: caret.x, y: caret.y + layout.metrics.ascender },
          ctx.canvas.theme.textRun.cursorColor,
          ctx.canvas.theme.textRun.cursorWidthPx,
        );
        break;
      }
      case "overlay":
        break;
    }
  }

  #drawGlyphs(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const hovered = this.editor.textEditing.hoveredItemCell.peek();
    const active = this.editor.textEditing.stateCell.peek()?.nodeId === node.id;
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
            ...(active && hovered && glyph.sourceItemIds.includes(hovered)
              ? {
                  stroke: {
                    color: ctx.canvas.theme.textRun.hoverOutline,
                    widthPx: ctx.canvas.theme.textRun.hoverOutlineWidthPx,
                  },
                }
              : {}),
          });
          ctx.canvas.restore();
        }
        runBase += run.advance;
      }
    }
  }

  #scale(node: TextRunNode): number {
    return node.size / this.editor.font.metricsCell.peek().unitsPerEm;
  }
}
