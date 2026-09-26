import { Bounds, type Rect2D } from "@shift/geo";
import type { SegmentId } from "@shift/glyph-state";
import type { ComponentId, NodeId, PointId } from "@shift/types";
import type { NodePoint } from "../../types/coordinates";
import { SCREEN_HIT_RADIUS } from "../editor/rendering/constants";
import { OutlineRenderer } from "../editor/rendering/Outline";
import {
  Anchors,
  ControlLines,
  DebugOverlays,
  Guides,
  Handles,
  Segments,
} from "../editor/rendering/overlays";
import { displayAdvance } from "../utils/unicode";
import { computed, keyedCache, track } from "../signals/index";
import type { GlyphRenderModel } from "../model/Glyph";
import type { GlyphContour } from "../model/ComponentGlyph";
import type { HandleState } from "../../types/graphics";
import type { GlyphRenderContour } from "../../types/glyphRender";
import { NodeDefinition } from "./NodeDefinition";
import type { GlyphNode } from "../../types/node";
import type { RenderContext, RenderPass } from "../../types/rendering";
import type { PointerTarget } from "../../types/target";
import type { GlyphOutlineTarget, ResolvedGlyphOutlineTarget } from "../../types/glyphOutline";
import { emptyExternalAxisLocation, externalAxisLocationFromLocation } from "../variation/location";
import { GlyphOutlines } from "./GlyphOutlines";

const EMPTY_OUTLINE_LOCATION = emptyExternalAxisLocation();
const GLYPH_OUTLINE_COLOR = "rgba(139, 111, 207, 0.45)";
const GLYPH_OUTLINE_WIDTH_PX = 1;

export class GlyphNodeDefinition extends NodeDefinition<GlyphNode> {
  readonly kind: GlyphNode["kind"] = "glyph";

  readonly #outline = new OutlineRenderer();
  readonly #debugOverlays = new DebugOverlays();
  readonly #controlLines = new ControlLines();
  readonly #anchors = new Anchors();
  readonly #segments = new Segments();
  readonly #handles = new Handles();
  readonly #guides = new Guides();
  readonly #outlineViews = keyedCache({
    name: "glyphNode.outlineViews",
    key: (target: GlyphOutlineTarget) => {
      switch (target.kind) {
        case "source":
          return `source:${target.sourceId}`;
        case "instance":
          return `instance:${target.instanceId}`;
      }
    },
    create: (targetCell) => {
      const resolvedCell = computed(() => this.#resolveOutlineTarget(targetCell.value), {
        name: "glyphNode.outlineTarget",
      });

      return {
        resolvedCell,
        externalLocationCell: computed(
          () => resolvedCell.value?.externalLocation ?? EMPTY_OUTLINE_LOCATION,
          { name: "glyphNode.outlineLocation" },
        ),
        activeSourceIdCell: computed(() => resolvedCell.value?.activeSourceId ?? null, {
          name: "glyphNode.outlineSource",
        }),
      };
    },
  });

  /** Node-scoped variation outlines rendered by this glyph behavior plugin. */
  readonly outlines = new GlyphOutlines();

  bounds(node: GlyphNode): Rect2D | null {
    const bounds = this.#view(node)?.bounds;
    if (!bounds) return null;

    return Bounds.toRect(
      Bounds.create(
        { x: bounds.min.x + node.position.x, y: bounds.min.y + node.position.y },
        { x: bounds.max.x + node.position.x, y: bounds.max.y + node.position.y },
      ),
    );
  }

  hit(node: GlyphNode, point: NodePoint): PointerTarget | null {
    const geometry = this.#view(node);
    if (!geometry) return null;

    const hit = geometry.hitAt(point, this.editor.hitRadius);
    if (hit) {
      switch (hit.kind) {
        case "segment": {
          const segment = geometry.segment(hit.id);
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

    const contours = geometry.contours;
    for (let index = contours.length - 1; index >= 0; index--) {
      const contour = contours[index];
      const component = contour?.component;
      if (!component) continue;
      if (!contour.segments().some((segment) => segment.hit(point, this.editor.hitRadius)))
        continue;

      const componentId = component.componentPath[0];
      if (!componentId) continue;

      return {
        kind: "component",
        id: componentId,
        componentId,
        componentPath: component.componentPath,
        nodeId: node.id,
        glyphId: node.glyphId,
        point,
      };
    }

    const fillHit = geometry.fillHitsAt(point)[0];
    if (!fillHit) return null;

    switch (fillHit.kind) {
      case "root":
        return { kind: "node", node, point };

      case "component": {
        const componentId = fillHit.componentPath[0];
        if (!componentId) return null;

        return {
          kind: "component",
          id: componentId,
          componentId,
          componentPath: fillHit.componentPath,
          nodeId: node.id,
          glyphId: node.glyphId,
          point,
        };
      }
    }
  }

  draw(node: GlyphNode, ctx: RenderContext, pass: RenderPass): void {
    const editing = this.#isEditing(node);

    switch (pass) {
      case "background":
        if (editing) this.#drawBackground(node, ctx);
        return;

      case "content":
        this.#drawContent(node, ctx, editing);
        return;

      case "controls":
        if (editing) this.#drawControls(node, ctx);
        return;

      case "overlay":
        return;
    }
  }

  #view(node: GlyphNode): GlyphRenderModel | null {
    return (
      this.editor
        .glyphForId(node.glyphId)
        ?.renderModelAt(this.editor.externalLocationCell, this.editor.activeSourceIdCell) ?? null
    );
  }

  #isEditing(node: GlyphNode): boolean {
    return this.editor.editing.has(node.id);
  }

  #drawBackground(node: GlyphNode, ctx: RenderContext): void {
    const glyph = this.editor.glyphForId(node.glyphId);
    if (!glyph) return;

    const view = this.#view(node);
    if (!view) return;

    const unicode = glyph.entry.unicodes[0] ?? null;
    track(view.xAdvanceCell);

    const advance = displayAdvance(view.xAdvanceCell.peek(), glyph.name, unicode);

    track(this.editor.externalLocationCell);
    track(this.editor.activeSourceIdCell);
    track(this.editor.font.sourceMetricsInterpolationCell);

    const activeSourceId = this.editor.activeSourceId;
    const metrics = activeSourceId
      ? this.editor.font.metricsForSource(activeSourceId)
      : this.editor.font.metricsAtLocation(this.editor.externalLocation);

    this.#guides.draw(ctx.canvas, metrics, advance, this.editor.sessionMode === "preview");
  }

  #drawContent(node: GlyphNode, ctx: RenderContext, editing: boolean): void {
    const view = this.#view(node);
    if (!view) return;

    view.trackShape();

    if (editing) {
      this.#drawEditableContent(node, ctx, view);
    } else {
      this.#drawDisplayContent(ctx, view);
    }

    this.#drawOutlines(node, ctx);
  }

  /**
   * Returns the variation outlines drawn around a glyph node.
   *
   * @remarks
   * Published targets are hidden while the hand tool pans, and a target whose source or
   * instance no longer resolves is skipped. Tracks every input so render effects rerun.
   *
   * @param nodeId - Glyph scene occurrence being rendered.
   * @returns Drawn targets in published order.
   */
  visibleOutlines(nodeId: NodeId): readonly GlyphOutlineTarget[] {
    track(this.editor.toolCell);
    if (this.editor.toolCell.peek()?.id === "hand") return [];

    return this.outlines.forNode(nodeId).filter((target) => {
      const outline = this.#outlineViews.get(target);
      track(outline.resolvedCell);
      return outline.resolvedCell.peek() !== null;
    });
  }

  #drawOutlines(node: GlyphNode, ctx: RenderContext): void {
    const targets = this.visibleOutlines(node.id);
    if (targets.length === 0) return;

    const glyph = this.editor.glyphForId(node.glyphId);
    if (!glyph) return;

    for (const target of targets) {
      const outline = this.#outlineViews.get(target);
      const view = glyph.renderModelAt(outline.externalLocationCell, outline.activeSourceIdCell);
      view.trackShape();
      ctx.canvas.strokePath(view.drawPath, GLYPH_OUTLINE_COLOR, GLYPH_OUTLINE_WIDTH_PX);
    }
  }

  #resolveOutlineTarget(target: GlyphOutlineTarget): ResolvedGlyphOutlineTarget | null {
    switch (target.kind) {
      case "source": {
        track(this.editor.font.sourcesCell);
        track(this.editor.font.committedFontCell);
        const externalLocation = this.editor.font.externalLocationForSource(target.sourceId);
        if (!externalLocation) return null;

        return { externalLocation, activeSourceId: target.sourceId };
      }

      case "instance": {
        track(this.editor.font.namedInstancesCell);
        const instance = this.editor.font.namedInstancesCell
          .peek()
          .find((candidate) => candidate.id === target.instanceId);
        if (!instance) return null;

        return {
          externalLocation: externalAxisLocationFromLocation(instance.location),
          activeSourceId: null,
        };
      }
    }
  }

  #drawEditableContent(node: GlyphNode, ctx: RenderContext, view: GlyphRenderModel): void {
    track(view.rootClosedContoursPathCell);
    ctx.canvas.fillPath(view.rootClosedContoursPath, ctx.canvas.theme.glyph.editableFill);

    track(view.componentsCell);
    for (const component of view.components) {
      track(component.closedContoursPathCell);
      ctx.canvas.fillPath(component.closedContoursPath, ctx.canvas.theme.component.fill);
    }

    this.#outline.draw(ctx.canvas, view, {
      stroke: {
        color: ctx.canvas.theme.glyph.stroke,
        widthPx: ctx.canvas.theme.glyph.widthPx,
      },
    });

    for (const component of view.components) {
      for (const contour of component.contours) {
        ctx.canvas.strokePath(
          contour.path,
          ctx.canvas.theme.glyph.stroke,
          ctx.canvas.theme.component.widthPx,
        );
      }
    }

    const hoveredComponentId = this.#hoveredComponentId(node);
    if (hoveredComponentId) {
      const style = ctx.canvas.theme.component.hoverOutline;
      for (const component of view.components) {
        if (component.componentPath[0] !== hoveredComponentId) continue;

        for (const contour of component.contours) {
          ctx.canvas.strokePath(contour.path, style.stroke, style.widthPx);
        }
      }
    }

    this.#drawDebugOverlays(node, ctx, view);
  }

  #drawDisplayContent(ctx: RenderContext, view: GlyphRenderModel): void {
    track(view.closedContoursPathCell);
    track(view.openContoursPathCell);
    ctx.canvas.fillPath(view.closedContoursPath, ctx.canvas.theme.glyph.fill);
    ctx.canvas.strokePath(
      view.openContoursPath,
      ctx.canvas.theme.glyph.stroke,
      ctx.canvas.theme.glyph.widthPx,
    );
  }

  /**
   * Returns the point handles drawn for a glyph node and the visual state of each.
   *
   * @remarks
   * Handles at a location between sources use the `interpolated` state instead of
   * selection or hover styling. Hidden handles are omitted.
   *
   * @param node - Glyph scene occurrence whose controls are rendered.
   * @returns Handle state keyed by point; empty when the node has no render model.
   */
  handleStates(node: GlyphNode): ReadonlyMap<PointId, HandleState> {
    const view = this.#view(node);
    if (!view) return new Map();

    const { interpolated, rootContours } = this.#controlContours(view);
    return this.#handles.states(
      rootContours,
      this.editor.selection,
      this.editor.hover,
      interpolated,
      (pointId, contourId) => this.editor.handlesVisible(pointId, contourId),
    );
  }

  #controlContours(view: GlyphRenderModel): {
    interpolated: boolean;
    rootContours: readonly GlyphContour[];
  } {
    track(this.editor.font.axesCell);
    track(this.editor.font.sourcesCell);
    track(this.editor.font.committedFontCell);
    track(this.editor.activeSourceIdCell);
    track(this.editor.externalLocationCell);
    const interpolated =
      this.editor.activeSourceId === null &&
      this.editor.font.sourceAt(this.editor.externalLocation) === null;

    track(view.contoursCell);
    const rootContours = view.contours.filter(
      (contour) => contour.component === null && this.editor.handlesVisible(contour.contour.id),
    );
    return { interpolated, rootContours };
  }

  #drawControls(node: GlyphNode, ctx: RenderContext): void {
    const view = this.#view(node);
    if (!view) return;

    const { interpolated, rootContours } = this.#controlContours(view);
    for (const contour of rootContours) contour.trackShape();
    view.trackAnchors();

    this.#segments.draw(
      ctx.canvas,
      view,
      this.#selectedSegmentIds(node),
      this.#hoveredSegmentId(node),
    );
    this.#drawControlLines(
      node,
      ctx,
      rootContours.map((contour) => contour.contour),
    );
    this.#handles.draw(
      ctx,
      node,
      rootContours,
      this.editor.selection,
      this.editor.hover,
      interpolated,
      (pointId, contourId) => this.editor.handlesVisible(pointId, contourId),
    );
    this.#anchors.draw(ctx.canvas, view.anchors, {
      selection: this.editor.selection,
      hover: this.editor.hover,
      interpolated,
    });
  }

  #drawDebugOverlays(node: GlyphNode, ctx: RenderContext, view: GlyphRenderModel): void {
    this.#debugOverlays.draw(
      ctx.canvas,
      view,
      this.editor.debugOverlays,
      this.#hoveredSegmentId(node),
      ctx.canvas.pxToUpm(SCREEN_HIT_RADIUS),
    );
  }

  #drawControlLines(
    node: GlyphNode,
    ctx: RenderContext,
    contours: readonly GlyphRenderContour[],
  ): void {
    const sceneBounds = this.editor.camera.visibleSceneBounds(64);
    const origin = node.position;

    this.#controlLines.draw(ctx.canvas, contours, (from, to, contourId) => {
      if (
        !this.editor.handlesVisible(from.id, contourId) ||
        !this.editor.handlesVisible(to.id, contourId)
      ) {
        return false;
      }

      const minX = Math.min(from.x, to.x) + origin.x;
      const maxX = Math.max(from.x, to.x) + origin.x;
      const minY = Math.min(from.y, to.y) + origin.y;
      const maxY = Math.max(from.y, to.y) + origin.y;
      return !(
        maxX < sceneBounds.minX ||
        minX > sceneBounds.maxX ||
        maxY < sceneBounds.minY ||
        minY > sceneBounds.maxY
      );
    });
  }

  #selectedSegmentIds(node: GlyphNode): readonly SegmentId[] {
    const tool = this.editor.toolCell.peek();
    if (tool?.id === "select" && tool.state.type === "translating") return [];

    const segmentIds: SegmentId[] = [];

    for (const object of this.editor.objects(this.editor.selection.ids)) {
      if (object.kind !== "segment") continue;
      if (object.node.id !== node.id) continue;
      if (!this.editor.handlesVisible(object.contourId)) continue;

      segmentIds.push(object.segmentId);
    }

    return segmentIds;
  }

  #hoveredComponentId(node: GlyphNode): ComponentId | null {
    const id = this.editor.hover.id;
    if (!id) return null;

    const object = this.editor.object(id);
    if (object?.kind !== "component" || object.node.id !== node.id) return null;

    return object.componentId;
  }

  #hoveredSegmentId(node: GlyphNode): SegmentId | null {
    const id = this.editor.hover.id;
    if (!id) return null;

    const object = this.editor.object(id);
    if (object?.kind !== "segment") return null;
    if (object.node.id !== node.id) return null;
    if (!this.editor.handlesVisible(object.contourId)) return null;

    return object.segmentId;
  }
}
