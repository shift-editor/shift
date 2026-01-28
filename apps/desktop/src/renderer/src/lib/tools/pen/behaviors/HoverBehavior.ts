import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior } from "../types";
import { resolveCursorIntent } from "../intents";

export class HoverBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "pointerMove";
  }

  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null {
    if (state.type !== "ready" || event.type !== "pointerMove") return null;

    const cursor = resolveCursorIntent(event.point, {
      hitTest: editor.hitTest,
      getActiveContourId: () => editor.edit.getActiveContourId(),
      hasActiveDrawingContour: () => this.hasActiveDrawingContour(editor),
      shouldCloseContour: (p) => this.shouldCloseContour(p, editor),
      getMiddlePointAt: (p) => this.getMiddlePointAt(p, editor),
    });

    return {
      ...state,
      mousePos: event.point,
      intent: { action: "setCursor", cursor },
    };
  }

  onTransition(_prev: PenState, next: PenState, _event: ToolEvent, editor: Editor): void {
    if (next.type === "ready" && next.intent?.action === "setCursor") {
      editor.hitTest.updateHover((next as any).mousePos);
    }
  }

  private hasActiveDrawingContour(editor: Editor): boolean {
    const glyph = editor.edit.getGlyph();
    if (!glyph) return false;

    const activeContourId = editor.edit.getActiveContourId();
    const activeContour = glyph.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }

  private shouldCloseContour(pos: { x: number; y: number }, editor: Editor): boolean {
    const glyph = editor.edit.getGlyph();
    const activeContourId = editor.edit.getActiveContourId();
    const activeContour = glyph?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = activeContour.points[0];
    const dx = pos.x - firstPoint.x;
    const dy = pos.y - firstPoint.y;
    return Math.sqrt(dx * dx + dy * dy) < editor.screen.hitRadius;
  }

  private getMiddlePointAt(
    pos: { x: number; y: number },
    editor: Editor,
  ): { contourId: any; pointId: any; pointIndex: number } | null {
    const glyph = editor.edit.getGlyph();
    if (!glyph) return null;

    const activeContourId = editor.edit.getActiveContourId();
    const hitRadius = editor.screen.hitRadius;

    for (const contour of glyph.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (contour.points.length < 3) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        const dx = pos.x - point.x;
        const dy = pos.y - point.y;
        if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
          return {
            contourId: contour.id,
            pointId: point.id,
            pointIndex: i,
          };
        }
      }
    }
    return null;
  }
}
