import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type TextLayout } from "../text/layout";
import { clusterForCaret } from "../text/edit";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { ShiftNode, TextRunNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import { Mat, type Point2D } from "@shift/geo";
import { isTextItemId, type TextItemId } from "@shift/types";
import { track } from "../signals";

/** Projects one shared proof run through a placed, scaled scene node. */
export class TextRunNodeDefinition extends NodeDefinition<TextRunNode> {
  readonly kind: TextRunNode["kind"] = "textRun";
  readonly #outline = new OutlineRenderer();

  unitsTransform(node: TextRunNode): Mat {
    const scale = this.#scale(node);
    return Mat.Scale(scale, -scale);
  }

  /**
   * Places a child glyph at its item's layout position, so the run reflows around it.
   *
   * @remarks
   * Tracks the run's layout, so reactive readers of the child's placement
   * update when text, metrics, or location move it.
   */
  override childPosition(node: TextRunNode, child: ShiftNode): Point2D | null {
    if (child.kind !== "glyph" || !child.itemId) return null;
    const layoutCell = this.editor.text.layoutCell(node.runId);
    track(layoutCell);
    const layout = layoutCell.peek();
    const origin = layout && itemOrigin(layout, child.itemId);
    if (!origin) return null;

    return Mat.applyToPoint(this.unitsTransform(node), origin);
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

  /**
   * Hit-tests the run's glyph outlines: inside a fill or within hit radius of a contour.
   *
   * @remarks
   * Items drawn by a child are skipped; the child answers for its own glyph.
   * Later glyphs win. Caret placement uses {@link caretAt} instead.
   */
  hit(node: TextRunNode, point: LocalPoint): PointerTarget | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;

    const skip = this.#childItemIds(node);
    const radius = this.editor.hitRadius / this.#scale(node);
    let target: PointerTarget | null = null;
    for (const line of layout.lines) {
      let runBase = layout.origin.x;
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          const itemId = glyph.sourceItemIds[0];
          if (!glyph.glyphId || !itemId || skip.has(itemId)) continue;
          const model = this.editor
            .glyphForId(glyph.glyphId)
            ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell);
          if (!model) continue;

          const local = {
            x: point.x - (runBase + glyph.origin.x + glyph.xOffset),
            y: point.y - (line.y + glyph.origin.y + glyph.yOffset),
          };
          const onOutline = model.contours.some((contour) =>
            contour.segments().some((segment) => segment.hit(local, radius)),
          );
          if (onOutline || model.fillHitsAt(local).length > 0) {
            target = { kind: "text", node, point, itemId };
          }
        }
        runBase += run.advance;
      }
    }
    return target;
  }

  /**
   * Returns the caret cluster nearest a point inside the run's lines.
   *
   * @remarks
   * Accepts the glyph boxes, a narrow strip past each line's ends, and the
   * empty run's origin; blank canvas elsewhere returns null.
   *
   * @param node - the run node.
   * @param point - a point in the run's own units.
   */
  caretAt(node: TextRunNode, point: LocalPoint): number | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    const run = this.editor.text.run(node.runId);
    if (!layout || !run) return null;

    const hit = layout.hitTest(point);
    if (hit) return hit.cluster + (hit.side === "right" ? 1 : 0);

    const padding = this.editor.hitRadius / this.#scale(node);
    for (const line of layout.lines) {
      if (point.y < line.y + line.descent - padding || point.y > line.y + line.ascent + padding)
        continue;
      const advance = line.runs.reduce((sum, part) => sum + part.advance, 0);
      if (point.x < -padding || point.x > advance + padding) continue;
      return point.x <= 0 ? line.clusterStart : line.clusterEnd - 1;
    }
    const nearEmptyOrigin =
      run.items.length === 0 &&
      Math.abs(point.x) <= padding &&
      point.y >= layout.metrics.descender - padding &&
      point.y <= layout.metrics.ascender + padding;
    return nearEmptyOrigin ? 0 : null;
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
        this.#drawGlyphs(ctx, layout, this.#childItemIds(node), this.#outlinedItemIds());
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

  #drawGlyphs(
    ctx: RenderContext,
    layout: TextLayout,
    skip: ReadonlySet<TextItemId>,
    outlined: ReadonlySet<TextItemId>,
  ): void {
    for (const line of layout.lines) {
      let runBase = layout.origin.x;
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (!glyph.glyphId || glyph.sourceItemIds.some((id) => skip.has(id))) continue;
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
          const hoverStroke = {
            color: ctx.canvas.theme.textRun.hoverOutline,
            widthPx: ctx.canvas.theme.textRun.hoverOutlineWidthPx,
          };
          const isOutlined = glyph.sourceItemIds.some((id) => outlined.has(id));
          this.#outline.draw(ctx.canvas, renderModel, {
            fill: ctx.canvas.theme.glyph.fill,
            stroke: isOutlined ? hoverStroke : null,
          });
          ctx.canvas.restore();
        }
        runBase += run.advance;
      }
    }
  }

  /** Hovered and selected items, which the run outlines. */
  #outlinedItemIds(): ReadonlySet<TextItemId> {
    const ids = new Set<TextItemId>();
    const hovered = this.editor.hover.id;
    if (isTextItemId(hovered)) ids.add(hovered);
    for (const id of this.editor.selection.ids) {
      if (isTextItemId(id)) ids.add(id);
    }
    return ids;
  }

  /** Items drawn by child glyph nodes instead of the run. */
  #childItemIds(node: TextRunNode): ReadonlySet<TextItemId> {
    const ids = new Set<TextItemId>();
    for (const child of this.editor.scene.children(node.id)) {
      if (child.kind === "glyph" && child.itemId) ids.add(child.itemId);
    }
    return ids;
  }

  #scale(node: TextRunNode): number {
    return node.size / this.editor.font.metricsCell.peek().unitsPerEm;
  }
}

/** Returns the drawn origin of an item's glyph in run units, or null when the item has no positioned glyph. */
function itemOrigin(layout: TextLayout, itemId: TextItemId): Point2D | null {
  for (const line of layout.lines) {
    let runBase = layout.origin.x;
    for (const run of line.runs) {
      for (const glyph of run.glyphs) {
        if (!glyph.sourceItemIds.includes(itemId)) continue;
        return {
          x: runBase + glyph.origin.x + glyph.xOffset,
          y: line.y + glyph.origin.y + glyph.yOffset,
        };
      }
      runBase += run.advance;
    }
  }
  return null;
}
