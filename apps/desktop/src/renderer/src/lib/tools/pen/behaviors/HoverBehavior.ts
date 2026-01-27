import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { PenState, PenBehavior } from "../types";
import { resolveCursorIntent } from "../intents";

export class HoverBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "pointerMove";
  }

  transition(
    state: PenState,
    event: ToolEvent,
    ctx: ToolContext,
  ): PenState | null {
    if (state.type !== "ready" || event.type !== "pointerMove") return null;

    const cursor = resolveCursorIntent(event.point, {
      hitTest: ctx.hitTest,
      getActiveContourId: () => ctx.edit.getActiveContourId(),
      hasActiveDrawingContour: () => this.hasActiveDrawingContour(ctx),
      shouldCloseContour: (p) => this.shouldCloseContour(p, ctx),
      getMiddlePointAt: (p) => this.getMiddlePointAt(p, ctx),
    });

    return {
      ...state,
      mousePos: event.point,
      intent: { action: "setCursor", cursor },
    };
  }

  onTransition(
    _prev: PenState,
    next: PenState,
    _event: ToolEvent,
    ctx: ToolContext,
  ): void {
    if (next.type === "ready" && next.intent?.action === "setCursor") {
      ctx.hitTest.updateHover((next as any).mousePos);
    }
  }

  private hasActiveDrawingContour(ctx: ToolContext): boolean {
    const snapshot = ctx.edit.getGlyph();
    if (!snapshot) return false;

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }

  private shouldCloseContour(pos: { x: number; y: number }, ctx: ToolContext): boolean {
    const snapshot = ctx.edit.getGlyph();
    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = activeContour.points[0];
    const dx = pos.x - firstPoint.x;
    const dy = pos.y - firstPoint.y;
    return Math.sqrt(dx * dx + dy * dy) < ctx.screen.hitRadius;
  }

  private getMiddlePointAt(
    pos: { x: number; y: number },
    ctx: ToolContext,
  ): { contourId: any; pointId: any; pointIndex: number } | null {
    const snapshot = ctx.edit.getGlyph();
    if (!snapshot) return null;

    const activeContourId = ctx.edit.getActiveContourId();
    const hitRadius = ctx.screen.hitRadius;

    for (const contour of snapshot.contours) {
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
