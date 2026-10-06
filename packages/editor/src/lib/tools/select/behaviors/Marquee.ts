import { Bounds, Curve, Rect, type Rect2D } from "@shift/geo";
import type { SelectableId } from "@shift/types";
import { sceneBounds } from "../../../editor/spaces";
import type { ToolContext } from "../../core/Behavior";
import type { DragEndEvent, DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Marquee implements SelectBehavior {
  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    const initialSelection = ctx.editor.selection.ids;
    if (!event.shiftKey && ctx.editor.selection.hasSelection()) {
      ctx.editor.selection.clear();
    }

    ctx.setState({
      type: "brushing",
      selection: {
        startPos: event.origin.scene,
        currentPos: event.coords.scene,
        initialSelection,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectIdsInRect(rect, ctx, event.shiftKey ? state.selection.initialSelection : []);

    ctx.setState({
      type: "brushing",
      selection: { ...state.selection, currentPos: event.coords.scene },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>, event: DragEndEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectIdsInRect(rect, ctx, event.shiftKey ? state.selection.initialSelection : []);

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    ctx.editor.selection.clear();
    ctx.setState({ type: "ready" });
    return true;
  }

  /**
   * Points inside the rect, plus segments it touches without catching just one end point.
   *
   * @remarks
   * A run's glyph gives up its points only while edited, as with clicks. With
   * nothing edited, the rect selects the run glyphs whose outline box it touches.
   */
  private getIdsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): Set<SelectableId> {
    const ids = new Set<SelectableId>();
    const editor = ctx.editor;
    const sceneRect = sceneBounds(Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height));

    if (!editor.editing.hasScope()) {
      const definition = editor.nodeDefinition("textRun");
      for (const node of editor.scene.nodesOfKind("textRun")) {
        const localRect = editor.toLocalBounds(node, sceneRect);
        for (const item of editor.text.run(node.runId)?.items ?? []) {
          const bounds = definition.itemBounds(node, item.id);
          if (bounds && Bounds.overlaps(bounds, localRect)) ids.add(item.id);
        }
      }
    }

    for (const node of editor.scene.nodesOfKind("glyph")) {
      if (node.parentId !== null && !editor.editing.has(node.id)) continue;
      const glyph = editor.glyphForId(node.glyphId);
      if (!glyph) continue;

      const geometry = glyph.geometryAt(editor.externalLocation);
      const localRect = Bounds.toRect(editor.toLocalBounds(node, sceneRect));

      for (const point of geometry.allPoints) {
        if (Rect.containsPoint(localRect, point)) ids.add(point.id);
      }
      for (const segment of geometry.segments) {
        const startInside = Rect.containsPoint(localRect, segment.start);
        const endInside = Rect.containsPoint(localRect, segment.end);
        // Brushing one end point selects that point alone, not the segments leaving it.
        if (startInside !== endInside) continue;
        if (Curve.intersectsRect(segment.toCurve(), localRect)) ids.add(segment.id);
      }
    }

    return ids;
  }

  private selectIdsInRect(
    rect: Rect2D,
    ctx: ToolContext<SelectState>,
    initialSelection: readonly SelectableId[],
  ): void {
    if (ctx.editor.sessionMode === "preview") {
      ctx.editor.selection.clear();
      return;
    }

    const ids = this.getIdsInRect(rect, ctx);
    ctx.editor.selection.select([...initialSelection, ...ids]);
  }
}
