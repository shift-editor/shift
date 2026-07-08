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
import type { GlyphInstance } from "@/lib/model/Glyph";
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
    const instance = this.editor.font.instance(node.glyphId, this.editor.designLocationCell);
    if (!instance) return null;

    const hit = instance.geometry.hitAt(point, this.editor.hitRadius);
    if (!hit) return null;

    switch (hit.kind) {
      case "segment": {
        const segment = instance.geometry.segment(hit.id);
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

  #instance(node: GlyphNode): GlyphInstance | null {
    return this.editor.font.instance(node.glyphId, this.editor.designLocationCell);
  }

  #isEditing(node: GlyphNode): boolean {
    return this.editor.editing.has(node.id);
  }

  #drawBackground(node: GlyphNode, ctx: RenderContext): void {
    const record = this.editor.font.glyph(node.glyphId);
    if (!record) return;

    const instance = this.#instance(node);
    if (!instance) return;

    const unicode = record.unicodes[0] ?? null;
    track(instance.xAdvanceCell);

    const advance = displayAdvance(instance.xAdvanceCell.peek(), record.name, unicode);
    this.#guides.draw(ctx.canvas, this.editor.font.metrics, advance);
  }

  #drawContent(node: GlyphNode, ctx: RenderContext, editing: boolean): void {
    const instance = this.#instance(node);
    if (!instance) return;

    instance.render.trackShape();

    if (editing) {
      this.#drawEditableContent(node, ctx, instance);
      return;
    }

    this.#drawDisplayContent(ctx, instance);
  }

  #drawEditableContent(node: GlyphNode, ctx: RenderContext, instance: GlyphInstance): void {
    this.#outline.draw(ctx.canvas, instance.render.outline, {
      fill: null,
      stroke: {
        color: ctx.canvas.theme.glyph.stroke,
        widthPx: ctx.canvas.theme.glyph.widthPx,
      },
    });

    this.#drawDebugOverlays(node, ctx, instance);
  }

  #drawDisplayContent(ctx: RenderContext, instance: GlyphInstance): void {
    this.#outline.draw(ctx.canvas, instance.render.outline, {
      fill: ctx.canvas.theme.glyph.fill,
    });
  }

  #drawControls(node: GlyphNode, ctx: RenderContext): void {
    const instance = this.#instance(node);
    if (!instance) return;

    const renderModel = instance.render;

    this.#segments.draw(
      ctx.canvas,
      instance.geometry,
      this.#selectedSegmentIds(node),
      this.#hoveredSegmentId(node),
    );
    this.#drawControlLines(node, ctx, renderModel.contours);
    this.#handles.draw(ctx, node, instance, this.editor.selection, this.editor.hover);
    this.#anchors.draw(ctx.canvas, renderModel.anchors, {
      selection: this.editor.selection,
      hover: this.editor.hover,
    });
  }

  #drawDebugOverlays(node: GlyphNode, ctx: RenderContext, instance: GlyphInstance): void {
    this.#debugOverlays.draw(
      ctx.canvas,
      instance.geometry,
      this.editor.debugOverlays,
      this.#hoveredSegmentId(node),
      ctx.canvas.pxToUpm(SCREEN_HIT_RADIUS),
    );
  }

  #drawControlLines(
    node: GlyphNode,
    ctx: RenderContext,
    contours: GlyphInstance["render"]["contours"],
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
