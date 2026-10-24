import { NodeDefinition, type ChildPlacement } from "./NodeDefinition";
import { OutlineRenderer } from "../editor/rendering/Outline";
import { Caret, type PlacedGlyph, type TextLayout } from "../text/layout";
import { TextBuffer } from "../text/TextBuffer";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
import type { GlyphNode, ShiftNode, TextRunNode } from "../../types/node";
import type { TextItem } from "../text/layout/types";
import type { NodeReference } from "../../types/records";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import { spacingGapCenter, type SpacingGap, type SpacingSide } from "../../types/spacing";
import type { GlyphRenderModel } from "../model/Glyph";
import { Bounds, Mat, type Point2D } from "@shift/geo";
import {
  isTextItemId,
  type ComponentId,
  type GlyphId,
  type SelectableId,
  type TextItemId,
} from "@shift/types";
import { track } from "../signals";
import type { TransformTarget } from "../../types/transformTarget";
import { GlyphsTransform, type GlyphsTransformPart } from "./GlyphsTransform";

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
    const scale = this.emScale(node);
    return Mat.Scale(scale, -scale);
  }

  /**
   * Returns how many scene units one font unit of the run spans: its size over
   * the font's units per em, 1 when the run is set at the font's own size.
   */
  emScale(node: TextRunNode): number {
    return node.size / this.editor.font.metricsCell.peek().unitsPerEm;
  }

  /**
   * Places a child glyph at its item's layout position and the run's size, so
   * the run reflows around it and it matches the glyphs beside it.
   *
   * @remarks
   * Tracks the run's layout, so reactive readers of the child's placement
   * update when text, metrics, or location move it.
   */
  override childPlacement(node: TextRunNode, child: ShiftNode): ChildPlacement | null {
    if (child.kind !== "glyph" || !child.itemId) return null;
    const layoutCell = this.editor.text.layoutCell(node.runId);
    track(layoutCell);
    const layout = layoutCell.peek();
    const placed =
      layout?.placedGlyph(child.itemId, child.glyphId) ?? layout?.placedGlyphForItem(child.itemId);
    if (!placed) return null;

    return {
      position: Mat.applyToPoint(this.unitsTransform(node), placed.origin),
      scale: this.emScale(node),
    };
  }

  /** Returns the run's child glyph node, the glyph edited in place, or null. */
  childGlyph(node: TextRunNode): GlyphNode | null {
    for (const child of this.editor.scene.children(node.id)) {
      if (child.kind === "glyph") return child;
    }
    return null;
  }

  /** A run node depends on its run record. */
  override references(node: TextRunNode): readonly NodeReference[] {
    return [node.runId];
  }

  /** A run node lays out its run record's items. */
  override textItems(node: TextRunNode): readonly TextItem[] {
    return this.editor.text.run(node.runId)?.items ?? [];
  }

  /**
   * Double-clicking a run glyph edits it in place; double-clicking a component
   * of the edited glyph opens its base glyph right after it.
   */
  override onDoubleClick(node: TextRunNode, target: PointerTarget): boolean {
    const child = this.childGlyph(node);
    let itemId: TextItemId | null = null;
    let glyphId: GlyphId | null = null;
    if (target.kind === "text" && target.node.id === node.id) {
      itemId = target.itemId;
      glyphId = target.glyphId;
    }
    if (target.kind === "component" && child?.itemId && target.nodeId === child.id) {
      itemId = this.#insertComponentBase(node, child.itemId, target.componentId);
    }
    if (!itemId) return false;

    const edited = this.editItem(node, itemId, glyphId);
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
   * @param glyphId - which of the item's glyphs to edit, when shaping split
   *   its character into several; defaults to the item's main glyph.
   * @returns null when the item is not a glyph in the run or its glyph is not loaded.
   */
  editItem(
    node: TextRunNode,
    itemId: TextItemId,
    glyphId: GlyphId | null = null,
  ): GlyphNode | null {
    const item = this.editor.text
      .run(node.runId)
      ?.items.find((candidate) => candidate.id === itemId);
    if (!item || item.kind === "linebreak") return null;

    const editedGlyphId = glyphId ?? this.editor.text.glyphIdForItem(itemId);
    const current = this.childGlyph(node);
    if (current?.itemId === itemId && current.glyphId === editedGlyphId) return current;
    if (!editedGlyphId || !this.editor.glyphForId(editedGlyphId)) return null;

    const sourceId =
      current?.sourceId ?? this.editor.activeSourceId ?? this.editor.font.defaultSource.id;
    if (current) this.editor.scene.deleteNode(current.id);
    return this.editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      parentId: node.id,
      itemId,
      glyphId: editedGlyphId,
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
   * is placed by its first selected item. See {@link GlyphsTransform}.
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

    const parts = new Map<GlyphId, GlyphsTransformPart>();
    let bounds: Bounds | null = null;
    for (const id of ids) {
      if (!isTextItemId(id)) return null;
      const placed = layout.placedGlyphForItem(id);
      const glyphId = placed?.glyph.glyphId;
      const layer = glyphId ? this.editor.layerForGlyph(glyphId, sourceId) : null;
      const itemBounds = this.itemBounds(node, id);
      if (!placed || !glyphId || !layer || !itemBounds) return null;

      bounds = bounds ? Bounds.union(bounds, itemBounds) : itemBounds;
      if (!parts.has(glyphId)) {
        parts.set(glyphId, {
          glyphId,
          layer,
          origin: placed.origin,
          bounds: Bounds.toRect(itemBounds),
        });
      }
    }
    if (!bounds) return null;

    return new GlyphsTransform(this.editor, Bounds.toRect(bounds), [...parts.values()]);
  }

  /** Items whose outline box touches `rect`; none while a glyph is edited, as with clicks. */
  override selectableInRect(node: TextRunNode, rect: LocalBounds): SelectableId[] {
    if (this.editor.editing.hasScope()) return [];

    const ids: SelectableId[] = [];
    for (const item of this.textItems(node)) {
      const bounds = this.itemBounds(node, item.id);
      if (bounds && Bounds.overlaps(bounds, rect)) ids.push(item.id);
    }
    return ids;
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

    const radius = this.editor.hitRadiusIn(node);
    let target: PointerTarget | null = null;
    this.#forEachRunGlyph(node, layout, (placed, itemId, model, glyphId) => {
      const local = {
        x: point.x - placed.origin.x,
        y: point.y - placed.origin.y,
      };
      if (hitsOutline(model, local, radius)) {
        target = { kind: "text", node, point, itemId, glyphId };
      }
    });
    return target;
  }

  /**
   * Returns the spacing gap under a point, between two glyphs or at a line end.
   *
   * @remarks
   * A gap spans the outline edges on either side of the advance boundary and
   * the boundary itself, so negative sidebearings stay inside it, between the
   * line's descender and ascender, grown by the hit radius so tight gaps stay
   * reachable. Where gaps overlap, the one whose boundary is nearest wins. Outline edges come from each glyph's
   * live outline, so the gap follows edits.
   *
   * @param node - the run node.
   * @param point - a point in the run's own units.
   */
  spacingGapAt(node: TextRunNode, point: LocalPoint): SpacingGap | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;

    const padding = this.editor.hitRadiusIn(node);
    let nearest: SpacingGap | null = null;
    for (const gap of this.#gaps(node, layout)) {
      if (point.y < gap.bottom - padding || point.y > gap.top + padding) continue;

      // Negative sidebearings put an outline edge past a boundary, so span every edge.
      const xs = [
        gap.leftBoundary,
        gap.rightBoundary,
        gap.left?.edge ?? gap.leftBoundary,
        gap.right?.edge ?? gap.rightBoundary,
      ];
      if (point.x < Math.min(...xs) - padding || point.x > Math.max(...xs) + padding) continue;

      const distance = Math.abs(point.x - spacingGapCenter(gap));
      if (!nearest || distance < Math.abs(point.x - spacingGapCenter(nearest))) nearest = gap;
    }
    return nearest;
  }

  /**
   * Returns the gap between two items, measured now; null when they are no longer neighbours.
   *
   * @param leftItemId - the item before the gap, or null at a line start.
   * @param rightItemId - the item after the gap, or null at a line end.
   */
  spacingGapBetween(
    node: TextRunNode,
    leftItemId: TextItemId | null,
    rightItemId: TextItemId | null,
  ): SpacingGap | null {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    if (!layout) return null;

    for (const gap of this.#gaps(node, layout)) {
      const left = gap.left?.itemId ?? null;
      const right = gap.right?.itemId ?? null;
      if (left === leftItemId && right === rightItemId) return gap;
    }
    return null;
  }

  /** Returns every gap of the run in reading order, measured now. */
  spacingGaps(node: TextRunNode): SpacingGap[] {
    const layout = this.editor.text.layoutCell(node.runId).peek();
    return layout ? [...this.#gaps(node, layout)] : [];
  }

  /** Every gap of the run: before each line, between neighbours, and after each line. */
  *#gaps(node: TextRunNode, layout: TextLayout): Iterable<SpacingGap> {
    const { ascender, descender } = layout.metrics;
    const modelFor = this.#models();
    for (const line of this.#lines(layout)) {
      const baseline = line[0]!.baseline;
      const top = baseline + ascender;
      const bottom = baseline + descender;

      for (let index = 0; index <= line.length; index++) {
        const before = line[index - 1];
        const after = line[index];
        const leftBoundary = before ? before.left + before.glyph.xAdvance : after!.left;
        const rightBoundary = after ? after.left : leftBoundary;
        const left = before ? this.#spacingSide(before, leftBoundary, "right", modelFor) : null;
        const right = after ? this.#spacingSide(after, rightBoundary, "left", modelFor) : null;
        if (left || right) {
          yield { node, left, right, leftBoundary, rightBoundary, baseline, top, bottom };
        }
      }
    }
  }

  /** The run's placed glyphs grouped by line, in order; empty lines are skipped. */
  #lines(layout: TextLayout): PlacedGlyph[][] {
    const lines: PlacedGlyph[][] = [];
    for (const placed of layout.placedGlyphs) {
      const line = lines[lines.length - 1];
      if (line && line[0]!.lineIndex === placed.lineIndex) line.push(placed);
      else lines.push([placed]);
    }
    return lines;
  }

  /** The side of `placed` facing a gap at `boundary`; null without an outline. */
  #spacingSide(
    placed: PlacedGlyph,
    boundary: number,
    facing: "left" | "right",
    modelFor: (glyphId: GlyphId) => GlyphRenderModel | null,
  ): SpacingSide | null {
    const itemId = placed.glyph.sourceItemIds[0];
    const glyphId = placed.glyph.glyphId;
    const bounds = glyphId ? modelFor(glyphId)?.bounds : null;
    if (!itemId || !glyphId || !bounds) return null;

    if (facing === "right") {
      const edge = placed.origin.x + bounds.max.x;
      return { itemId, glyphId, sidebearing: boundary - edge, edge };
    }
    const edge = placed.origin.x + bounds.min.x;
    return { itemId, glyphId, sidebearing: edge - boundary, edge };
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

    const padding = this.editor.hitRadiusIn(node);
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

  override draw(node: TextRunNode, ctx: RenderContext, pass: RenderPass): void {
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

  /**
   * Fills every run glyph, strokes its open contours, and outlines it when hovered or selected.
   *
   * @remarks
   * One path batch for the whole run: a glyph costs one translate and one
   * fill, plus a stroke only when it has open contours. Each distinct glyph
   * subscribes and resolves its paths once per draw (see {@link distinctGlyph}).
   */
  #drawGlyphs(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const canvas = ctx.canvas;
    const outlined = this.#outlinedItemIds();
    const outlineStroke = {
      color: canvas.theme.textRun.hoverOutline,
      widthPx: canvas.theme.textRun.hoverOutlineWidthPx,
    };
    const distinct = new Map<GlyphRenderModel, DistinctGlyph>();
    canvas.withPathBatch(canvas.theme.glyph, (batch) => {
      this.#forEachRunGlyph(node, layout, (placed, itemId, model) => {
        let glyph = distinct.get(model);
        if (!glyph) {
          glyph = distinctGlyph(model);
          distinct.set(model, glyph);
        }
        batch.offset(placed.origin.x, placed.origin.y);
        batch.fill(glyph.closed);
        if (glyph.open) batch.stroke(glyph.open);
        if (outlined.has(itemId)) this.#outline.draw(canvas, model, { stroke: outlineStroke });
      });
    });
  }

  #drawCaret(node: TextRunNode, ctx: RenderContext, layout: TextLayout): void {
    const editing = this.editor.textEditing.stateCell.peek();
    const run = this.editor.text.run(node.runId);
    if (editing?.nodeId !== node.id || !run) return;

    const caret = Caret.atCluster(
      layout,
      new TextBuffer(run.items, editing.focus).focusCluster,
    ).position();
    ctx.canvas.line(
      { x: caret.x, y: caret.y + layout.metrics.descender },
      { x: caret.x, y: caret.y + layout.metrics.ascender },
      ctx.canvas.theme.textRun.cursorColor,
      ctx.canvas.theme.textRun.cursorWidthPx,
    );
  }

  /**
   * Visits the glyphs the run draws and hits itself: every loaded glyph except the edited child's.
   *
   * @remarks
   * Resolves each distinct glyph's render model once per walk, so a reactive
   * caller subscribes to each glyph's load once however often it occurs. A
   * callback rather than an iterator, so a walk over a long run allocates
   * nothing per glyph.
   */
  #forEachRunGlyph(
    node: TextRunNode,
    layout: TextLayout,
    visit: (
      placed: PlacedGlyph,
      itemId: TextItemId,
      model: GlyphRenderModel,
      glyphId: GlyphId,
    ) => void,
  ): void {
    const skip = this.#editedChildGlyph(node, layout);
    const modelFor = this.#models();
    for (const placed of layout.placedGlyphs) {
      const itemId = placed.glyph.sourceItemIds[0];
      const glyphId = placed.glyph.glyphId;
      if (!itemId || placed === skip || !glyphId) continue;
      const model = modelFor(glyphId);
      if (model) visit(placed, itemId, model, glyphId);
    }
  }

  /** The child's placed glyph while the child is edited; otherwise the child is plain text. */
  #editedChildGlyph(node: TextRunNode, layout: TextLayout): PlacedGlyph | null {
    const child = this.childGlyph(node);
    if (!child?.itemId || !this.editor.editing.has(child.id)) return null;
    return layout.placedGlyph(child.itemId, child.glyphId);
  }

  #model(glyphId: GlyphId): GlyphRenderModel | null {
    return (
      this.editor
        .glyphForId(glyphId)
        ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell) ?? null
    );
  }

  /**
   * Returns a lookup that resolves each glyph's render model once, for one walk over a run.
   *
   * @remarks
   * A glyph's first lookup subscribes a reactive caller to its load, even when
   * it misses, as {@link #model} does; later lookups return the remembered
   * result. Use one lookup per walk: it does not see a glyph that loads during it.
   */
  #models(): (glyphId: GlyphId) => GlyphRenderModel | null {
    const models = new Map<GlyphId, GlyphRenderModel | null>();
    return (glyphId) => {
      let model = models.get(glyphId);
      if (model === undefined) {
        model = this.#model(glyphId);
        models.set(glyphId, model);
      }
      return model;
    };
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
}

/** One distinct glyph's display paths, resolved once per draw of a run. */
interface DistinctGlyph {
  readonly closed: Path2D;
  /** Null when the glyph has no open contours, so nothing is stroked. */
  readonly open: Path2D | null;
}

/**
 * Subscribes the reactive caller to a glyph's display and returns its paths.
 *
 * @remarks
 * Subscribes to the open-contours path only while there are open contours;
 * {@link GlyphRenderModel.hasOpenContoursCell} reruns the caller when a
 * contour opens.
 */
function distinctGlyph(model: GlyphRenderModel): DistinctGlyph {
  model.trackShape();
  track(model.closedContoursPathCell);
  track(model.hasOpenContoursCell);
  if (!model.hasOpenContoursCell.peek()) return { closed: model.closedContoursPath, open: null };

  track(model.openContoursPathCell);
  return { closed: model.closedContoursPath, open: model.openContoursPath };
}

/** Whether a glyph-local point is inside a fill or within `radius` of a contour. */
function hitsOutline(model: GlyphRenderModel, point: Point2D, radius: number): boolean {
  // Beyond the outline's bounds grown by the radius, no contour is near and no fill holds the point.
  const bounds = model.bounds;
  if (
    !bounds ||
    point.x < bounds.min.x - radius ||
    point.x > bounds.max.x + radius ||
    point.y < bounds.min.y - radius ||
    point.y > bounds.max.y + radius
  ) {
    return false;
  }

  const onContour = model.contours.some((contour) =>
    contour.segments().some((segment) => segment.hit(point, radius)),
  );
  return onContour || model.fillHitsAt(point).length > 0;
}
