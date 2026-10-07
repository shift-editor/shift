import { NodeDefinition } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type PlacedGlyph, type TextLayout } from "../text/layout";
import { clusterForCaret } from "../text/edit";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { GlyphNode, ShiftNode, TextRunNode } from "../../types/node";
import type { NodeReference } from "../../types/records";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import type { Glyph, GlyphLayer, GlyphRenderModel } from "../model/Glyph";
import { Bounds, Mat, type Point2D, type Rect2D } from "@shift/geo";
import { isTextItemId, type ComponentId, type GlyphId, type TextItemId } from "@shift/types";
import { batch, track } from "../signals";
import type { SelectableId } from "../../types/object";
import type { TransformAction, TransformTarget } from "../../types/transformTarget";
import type { GlyphTransformEdit } from "../model/GlyphTransformEdit";
import type { InspectorSection } from "../../types/inspector";
import { glyphMetricsTarget } from "../inspector/glyphMetricsTarget";
import type { ShiftId } from "../../types/object";

const GLYPH_LABELS: Record<TransformAction, string> = {
  move: "Move glyphs",
  scale: "Scale glyphs",
  rotate: "Rotate glyphs",
};

/**
 * Projects one shared proof run through a placed, scaled scene node.
 *
 * @remarks
 * A run edits at most one of its glyphs in place through a child `GlyphNode`
 * pointing at an item. This definition places the child at its item, stops
 * drawing and hitting that item while the child is edited, switches the
 * child (`editItem`, also on
 * double-click), and deletes it when its item is removed.
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

  /** Run items are described by the metrics of their glyphs, each glyph once. */
  override inspect(_node: TextRunNode, parts: readonly ShiftId[]): readonly InspectorSection[] {
    const glyphs = new Map<GlyphId, Glyph>();
    for (const id of parts) {
      const item = isTextItemId(id) ? this.editor.text.itemLocation(id)?.item : null;
      if (item?.kind !== "glyph") continue;

      const entry = this.editor.font.entryForName(item.glyphName);
      const glyph = entry ? this.editor.glyphForId(entry.id) : null;
      if (entry && glyph) glyphs.set(entry.id, glyph);
    }
    if (glyphs.size === 0) return [];

    return [
      { kind: "glyphMetrics", metrics: glyphMetricsTarget(this.editor, [...glyphs.values()]) },
    ];
  }

  /** A run node depends on its run record. */
  override references(node: TextRunNode): readonly NodeReference[] {
    return [node.runId];
  }

  /**
   * Double-clicking a run glyph edits it in place; double-clicking a component
   * of the edited glyph opens its base glyph right after it.
   */
  override onDoubleClick(node: TextRunNode, target: PointerTarget): boolean {
    const child = this.childGlyph(node);
    let itemId: TextItemId | null = null;
    if (target.kind === "text" && target.node.id === node.id) itemId = target.itemId;
    if (target.kind === "component" && child?.itemId && target.nodeId === child.id) {
      itemId = this.#insertComponentBase(node, child.itemId, target.componentId);
    }
    if (!itemId) return false;

    const edited = this.editItem(node, itemId);
    if (!edited) return false;
    this.editor.enterNode(edited.id);
    return true;
  }

  /** Deletes the child glyph when its item is no longer in the run. */
  override onContentChange(node: TextRunNode): void {
    const child = this.childGlyph(node);
    if (!child?.itemId) return;
    const items = this.editor.text.items(node);
    if (!items.some((item) => item.id === child.itemId)) this.editor.scene.deleteNode(child.id);
  }

  /**
   * Makes one of the run's items its child glyph, replacing any previous child.
   *
   * @remarks
   * Writes scene records, so call it inside a history capture (hooks already
   * are). Replaces rather than re-points the child (delete and create), so
   * per-node caches never see a node change glyph. The new child shows the
   * previous child's source, or the active source. Does not enter the child.
   *
   * @returns null when the item is not a glyph in the run or its glyph is not loaded.
   */
  editItem(node: TextRunNode, itemId: TextItemId): GlyphNode | null {
    const item = this.editor.text
      .run(node.runId)
      ?.items.find((candidate) => candidate.id === itemId);
    if (item?.kind !== "glyph") return null;

    const current = this.childGlyph(node);
    if (current?.itemId === itemId) return current;

    const entry = this.editor.font.entryForName(item.glyphName);
    if (!entry || !this.editor.glyphForId(entry.id)) return null;

    const sourceId =
      current?.sourceId ?? this.editor.activeSourceId ?? this.editor.font.defaultSource.id;
    if (current) this.editor.scene.deleteNode(current.id);
    return this.editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      parentId: node.id,
      itemId,
      glyphId: entry.id,
      sourceId,
      position: { x: 0, y: 0 },
    });
  }

  /**
   * Inserts a component's base glyph after an item.
   *
   * @remarks
   * A drawn component's base is always loaded: `Font.loadGlyphs` loads
   * component bases with the glyph that uses them.
   */
  #insertComponentBase(
    node: TextRunNode,
    afterId: TextItemId,
    componentId: ComponentId,
  ): TextItemId | null {
    const component = this.editor.object(componentId);
    if (component?.kind !== "component") return null;
    const base = this.editor.text.glyphItem(component.component.glyphId);
    if (!base || !this.editor.text.insertAfter(node.runId, afterId, [base])) return null;
    return base.id;
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
   * Returns one item's outline bounds in the run's units.
   *
   * @remarks
   * Tracks the layout and the glyph's outline, so the transform box follows
   * respacing and edits.
   *
   * @returns null for line breaks, missing glyphs, and glyphs without an outline.
   */
  itemBounds(node: TextRunNode, itemId: TextItemId): LocalBounds | null {
    const layoutCell = this.editor.text.layoutCell(node.runId);
    track(layoutCell);
    const placed = layoutCell.peek()?.placedGlyphForItem(itemId);
    const model = placed?.glyph.glyphId ? this.#model(placed.glyph.glyphId) : null;
    if (!placed || !model) return null;

    track(model.boundsCell);
    const bounds = model.bounds;
    if (!bounds) return null;

    const { x, y } = placed.origin;
    return localBounds({
      min: { x: bounds.min.x + x, y: bounds.min.y + y },
      max: { x: bounds.max.x + x, y: bounds.max.y + y },
    });
  }

  /**
   * Selected glyphs transform whole at the active source, each distinct glyph once.
   *
   * @remarks
   * Each glyph is its own part, pivoting on its own bounds, so a scale keeps
   * every glyph on its own baseline and edge; a glyph selected several times
   * is placed by its first selected item. The outline lands where the box
   * shows; scaling keeps the right sidebearing, moving and rotating keep the
   * advance. Components built on another selected
   * glyph follow that glyph instead of transforming again.
   *
   * @returns null when any selected item is not a loaded glyph with a layer at the active source.
   */
  override transformTarget(
    node: TextRunNode,
    ids: readonly SelectableId[],
  ): TransformTarget | null {
    const sourceId = this.editor.activeSourceId;
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!sourceId || !layout || this.editor.sessionMode !== "workspace") return null;

    const parts = new Map<GlyphId, { layer: GlyphLayer; origin: Point2D; bounds: Rect2D }>();
    let bounds: Bounds | null = null;
    for (const id of ids) {
      if (!isTextItemId(id)) return null;
      const placed = layout.placedGlyphForItem(id);
      const glyphId = placed?.glyph.glyphId;
      const layer = glyphId ? this.editor.glyphForId(glyphId)?.layerForSource(sourceId) : null;
      const itemBounds = this.itemBounds(node, id);
      if (!placed || !glyphId || !layer || !itemBounds) return null;

      bounds = bounds ? Bounds.union(bounds, itemBounds) : itemBounds;
      if (!parts.has(glyphId)) {
        parts.set(glyphId, { layer, origin: placed.origin, bounds: Bounds.toRect(itemBounds) });
      }
    }
    if (!bounds) return null;

    const transformedGlyphIds = new Set(parts.keys());
    return {
      bounds: Bounds.toRect(bounds),
      begin: (action) => {
        const edits: { edit: GlyphTransformEdit; bounds: Rect2D }[] = [];
        try {
          for (const { layer, origin, bounds } of parts.values()) {
            const keepRightSidebearing = action === "scale";
            const edit = layer.beginTransformEdit({
              origin,
              keepRightSidebearing,
              transformedGlyphIds,
            });
            edits.push({ edit, bounds });
          }
        } catch (error) {
          for (const { edit } of edits) edit.discard();
          throw error;
        }
        return {
          preview: (deltaFor) =>
            batch(() => {
              for (const { edit, bounds } of edits) edit.preview(deltaFor({ bounds }));
            }),
          commit: () =>
            this.editor.transaction(GLYPH_LABELS[action], () => {
              for (const { edit } of edits) edit.commit();
            }),
          discard: () => {
            for (const { edit } of edits) edit.discard();
          },
        };
      },
    };
  }

  /**
   * Hit-tests the run's glyph outlines: inside a fill or within hit radius of a contour.
   *
   * @remarks
   * While the child is edited its item is skipped, so the child answers for
   * its own glyph; otherwise the child is plain text and the run hits it.
   * Later glyphs win where outlines overlap. Caret placement uses {@link caretAt}.
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

  /** The glyphs the run draws and hits itself: every loaded glyph except an edited child's item. */
  *#runGlyphs(
    node: TextRunNode,
    layout: TextLayout,
  ): Iterable<{ placed: PlacedGlyph; itemId: TextItemId; model: GlyphRenderModel }> {
    const skip = this.#editedChildItemId(node);
    for (const placed of layout.placedGlyphs) {
      const itemId = placed.glyph.sourceItemIds[0];
      if (!itemId || itemId === skip || !placed.glyph.glyphId) continue;
      const model = this.#model(placed.glyph.glyphId);
      if (model) yield { placed, itemId, model };
    }
  }

  /** The child's item while the child is edited; otherwise the child is plain text. */
  #editedChildItemId(node: TextRunNode): TextItemId | null {
    const child = this.childGlyph(node);
    if (!child?.itemId || !this.editor.editing.has(child.id)) return null;
    return child.itemId;
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
