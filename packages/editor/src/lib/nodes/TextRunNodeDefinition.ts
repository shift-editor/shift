import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type PlacedGlyph, type TextLayout } from "../text/layout";
import { clusterForCaret } from "../text/edit";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { GlyphNode, ShiftNode, TextRunNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import type { GlyphRenderModel } from "../model/Glyph";
import { Mat, type Point2D } from "@shift/geo";
import { isTextItemId, type GlyphId, type TextItemId } from "@shift/types";
import { track } from "../signals";

/**
 * Projects one shared proof run through a placed, scaled scene node.
 *
 * @remarks
 * A run edits at most one of its glyphs in place through a child `GlyphNode`
 * pointing at an item. This definition owns the read side of that: it places
 * the child at its item and stops drawing and hitting that item. Writes that
 * change the child live in `lib/text/runChildren`.
 */
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
    const placed = layoutCell.peek()?.placedGlyphForItem(child.itemId);
    if (!placed) return null;

    return Mat.applyToPoint(this.unitsTransform(node), placed.origin);
  }

  /** Returns the run's child glyph node, the glyph edited in place, or null. */
  childGlyph(node: TextRunNode): GlyphNode | null {
    for (const child of this.editor.scene.children(node.id)) {
      if (child.kind === "glyph") return child;
    }
    return null;
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
   * The child's item is skipped; the child answers for its own glyph. Later
   * glyphs win where outlines overlap. Caret placement uses {@link caretAt}.
   */
  hit(node: TextRunNode, point: LocalPoint): PointerTarget | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;

    const radius = this.editor.hitRadius / this.#scale(node);
    let target: PointerTarget | null = null;
    for (const { placed, itemId, model } of this.#runGlyphs(node, layout)) {
      const local = { x: point.x - placed.origin.x, y: point.y - placed.origin.y };
      if (hitsOutline(model, local, radius)) target = { kind: "text", node, point, itemId };
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
      case "background":
        this.#drawSelection(node, ctx);
        return;
      case "content":
        this.#drawGlyphs(node, ctx, layout);
        return;
      case "controls":
        this.#drawCaret(node, ctx, layout);
        return;
      case "overlay":
        return;
    }
  }

  #drawSelection(node: TextRunNode, ctx: RenderContext): void {
    if (this.editor.textEditing.stateCell.peek()?.nodeId !== node.id) return;
    for (const rect of this.editor.textEditing.selectionRects) {
      ctx.canvas.fillRect(
        rect.x,
        rect.bottom,
        rect.width,
        rect.top - rect.bottom,
        ctx.canvas.theme.textRun.selectionFill,
      );
    }
  }

  #drawGlyphs(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const outlined = this.#outlinedItemIds();
    const outlineStroke = {
      color: ctx.canvas.theme.textRun.hoverOutline,
      widthPx: ctx.canvas.theme.textRun.hoverOutlineWidthPx,
    };
    for (const { placed, itemId, model } of this.#runGlyphs(node, layout)) {
      model.trackShape();
      ctx.canvas.save();
      ctx.canvas.translate(placed.origin.x, placed.origin.y);
      this.#outline.draw(ctx.canvas, model, {
        fill: ctx.canvas.theme.glyph.fill,
        stroke: outlined.has(itemId) ? outlineStroke : null,
      });
      ctx.canvas.restore();
    }
  }

  #drawCaret(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const editing = this.editor.textEditing.stateCell.peek();
    const run = this.editor.text.run(node.runId);
    if (editing?.nodeId !== node.id || !run) return;

    const caret = Caret.atCluster(layout, clusterForCaret(run.items, editing.focus)).position();
    ctx.canvas.line(
      { x: caret.x, y: caret.y + layout.metrics.descender },
      { x: caret.x, y: caret.y + layout.metrics.ascender },
      ctx.canvas.theme.textRun.cursorColor,
      ctx.canvas.theme.textRun.cursorWidthPx,
    );
  }

  /** The glyphs the run draws itself: every loaded glyph except the child's item. */
  *#runGlyphs(
    node: TextRunNode,
    layout: TextLayout,
  ): Iterable<{ placed: PlacedGlyph; itemId: TextItemId; model: GlyphRenderModel }> {
    const childItemId = this.childGlyph(node)?.itemId;
    for (const placed of layout.placedGlyphs) {
      const itemId = placed.glyph.sourceItemIds[0];
      if (!itemId || itemId === childItemId || !placed.glyph.glyphId) continue;
      const model = this.#model(placed.glyph.glyphId);
      if (model) yield { placed, itemId, model };
    }
  }

  #model(glyphId: GlyphId): GlyphRenderModel | null {
    return (
      this.editor
        .glyphForId(glyphId)
        ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell) ?? null
    );
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

  #scale(node: TextRunNode): number {
    return node.size / this.editor.font.metricsCell.peek().unitsPerEm;
  }
}

/** Whether a glyph-local point is inside a fill or within `radius` of a contour. */
function hitsOutline(model: GlyphRenderModel, point: Point2D, radius: number): boolean {
  const onContour = model.contours.some((contour) =>
    contour.segments().some((segment) => segment.hit(point, radius)),
  );
  return onContour || model.fillHitsAt(point).length > 0;
}
