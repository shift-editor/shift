import type { Rect2D } from "@shift/geo";
import type { SegmentId } from "@shift/glyph-state";
import type { NodePoint } from "@/types/coordinates";
import { SCREEN_HIT_RADIUS } from "@/lib/editor/rendering/constants";
import { OutlineRenderer } from "@/lib/editor/rendering/Outline";
import {
  Anchors,
  ControlLines,
  DebugOverlays,
  Guides,
  Handles,
  Segments,
} from "@/lib/editor/rendering/overlays";
import { displayAdvance } from "@/lib/utils/unicode";
import { track } from "@/lib/signals";
import type { GlyphRenderModel } from "@/lib/model/Glyph";
import type { GlyphRenderContour } from "@/types/glyphRender";
import { NodeDefinition } from "@/lib/nodes/NodeDefinition";
import type { GlyphNode } from "@/types/node";
import type { RenderContext, RenderPass } from "@/types/rendering";
import type { PointerTarget } from "@/types/target";

export class GlyphNodeDefinition extends NodeDefinition<GlyphNode> {
  readonly kind: GlyphNode["kind"] = "glyph";

  readonly #outline = new OutlineRenderer();
  readonly #debugOverlays = new DebugOverlays();
  readonly #controlLines = new ControlLines();
  readonly #anchors = new Anchors();
  readonly #segments = new Segments();
  readonly #handles = new Handles();
  readonly #guides = new Guides();

  bounds(_node: GlyphNode): Rect2D | null {
    return null;
  }

  hit(node: GlyphNode, point: NodePoint): PointerTarget | null {
    const geometry = this.#view(node);
    if (!geometry) return null;

    const hit = geometry.hitAt(point, this.editor.hitRadius);
    if (!hit) return null;

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
      return;
    }

    this.#drawDisplayContent(ctx, view);
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

  #drawControls(node: GlyphNode, ctx: RenderContext): void {
    const view = this.#view(node);
    if (!view) return;

    track(this.editor.font.axesCell);
    track(this.editor.font.sourcesCell);
    track(this.editor.font.committedFontCell);
    track(this.editor.activeSourceIdCell);
    track(this.editor.externalLocationCell);
    const interpolated =
      this.editor.activeSourceId === null &&
      this.editor.font.sourceAt(this.editor.externalLocation) === null;

    track(view.contoursCell);
    const rootContours = view.contours.filter((contour) => contour.component === null);
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

    this.#controlLines.draw(ctx.canvas, contours, (from, to) => {
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

      segmentIds.push(object.segmentId);
    }

    return segmentIds;
  }

  #hoveredSegmentId(node: GlyphNode): SegmentId | null {
    const id = this.editor.hover.id;
    if (!id) return null;

    const object = this.editor.object(id);
    if (object?.kind !== "segment") return null;
    if (object.node.id !== node.id) return null;

    return object.segmentId;
  }
}
