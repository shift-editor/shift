import { Vec2 } from "@shift/geo";
import { IRenderer } from "@/types/graphics";
import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent } from "../core";
import { executeIntent, type PenIntent } from "./intents";
import type { PenState, PenBehavior } from "./types";
import { HoverBehavior, PlaceBehavior, HandleBehavior, EscapeBehavior } from "./behaviors";
import { DEFAULT_STYLES, PREVIEW_LINE_STYLE } from "../../styles/style";
import { drawHandle } from "@/lib/editor";

export type { PenState };

export class Pen extends BaseTool<PenState> {
  readonly id: ToolName = "pen";

  private behaviors: PenBehavior[] = [
    new HoverBehavior(),
    new EscapeBehavior(),
    new PlaceBehavior(),
    new HandleBehavior(),
  ];

  initialState(): PenState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = { type: "ready", mousePos: { x: 0, y: 0 } };
    this.ctx.cursor.set({ type: "pen" });
    this.ctx.edit.clearActiveContour();
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }

  handleModifier(key: string, pressed: boolean): boolean {
    if (key === "Space") {
      if (pressed) {
        this.ctx.tools.requestTemporary("hand", {
          onActivate: () => this.ctx.render.setPreviewMode(true),
          onReturn: () => this.ctx.render.setPreviewMode(false),
        });
      } else {
        this.ctx.tools.returnFromTemporary();
      }
      return true;
    }
    return false;
  }

  transition(state: PenState, event: ToolEvent): PenState {
    if (state.type === "idle") {
      return state;
    }

    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.ctx);
        if (result !== null) {
          return result;
        }
      }
    }

    return state;
  }

  onTransition(prev: PenState, next: PenState, event: ToolEvent): void {
    if (next.intent) {
      this.executePenIntent(next.intent, prev);
    }

    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.ctx);
    }

    if (next.type === "ready") {
      const pos = next.mousePos;
      this.updateCursorForPosition(pos);
    }
  }

  private executePenIntent(intent: PenIntent, prev: PenState): void {
    switch (intent.action) {
      case "close":
        this.batch("Close Contour", () => {
          executeIntent(intent, this.ctx);
        });
        break;

      case "continue":
        this.batch("Continue Contour", () => {
          executeIntent(intent, this.ctx);
        });
        break;

      case "splitPoint":
        this.batch("Split Contour", () => {
          executeIntent(intent, this.ctx);
        });
        break;

      case "splitSegment":
        this.batch("Split Segment", () => {
          executeIntent(intent, this.ctx);
        });
        break;

      case "placePoint":
        if (prev.type === "ready") {
          this.batch("Add Point", () => {
            const pointId = executeIntent(intent, this.ctx);
            if (this.state.type === "anchored") {
              (this.state as any).anchor.pointId = pointId;
            }
          });
        }
        break;

      case "abandonContour":
        this.batch("Abandon Contour", () => {
          executeIntent(intent, this.ctx);
        });
        break;

      case "setCursor":
        executeIntent(intent, this.ctx);
        break;

      case "updateHover":
        executeIntent(intent, this.ctx);
        break;
    }
  }

  private updateCursorForPosition(pos: Point2D): void {
    if (this.hasActiveDrawingContour()) {
      if (this.shouldCloseContour(pos.x, pos.y)) {
        this.ctx.cursor.set({ type: "pen-end" });
        return;
      }
      this.ctx.cursor.set({ type: "pen" });
      return;
    }

    const endpoint = this.ctx.hitTest.getContourEndpointAt(pos);
    if (endpoint && !endpoint.contour.closed) {
      this.ctx.cursor.set({ type: "pen-end" });
      return;
    }

    const middlePoint = this.getMiddlePointAt(pos);
    if (middlePoint) {
      this.ctx.cursor.set({ type: "pen-end" });
      return;
    }

    const segmentHit = this.ctx.hitTest.getSegmentAt(pos);
    if (segmentHit) {
      this.ctx.cursor.set({ type: "pen-add" });
      return;
    }

    this.ctx.cursor.set({ type: "pen" });
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const snapshot = this.ctx.edit.getGlyph();
    const activeContourId = this.ctx.edit.getActiveContourId();
    const activeContour = snapshot?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = activeContour.points[0];
    return Vec2.isWithin({ x, y }, firstPoint, this.ctx.screen.hitRadius);
  }

  private hasActiveDrawingContour(): boolean {
    const snapshot = this.ctx.edit.getGlyph();
    if (!snapshot) return false;

    const activeContourId = this.ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }

  private getLastOnCurvePoint(): Point2D | null {
    const snapshot = this.ctx.edit.getGlyph();
    if (!snapshot) return null;

    const activeContourId = this.ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.points.length === 0 || activeContour.closed) {
      return null;
    }

    for (let i = activeContour.points.length - 1; i >= 0; i--) {
      if (activeContour.points[i].pointType === "onCurve") {
        return {
          x: activeContour.points[i].x,
          y: activeContour.points[i].y,
        };
      }
    }
    return null;
  }

  private getMiddlePointAt(
    pos: Point2D,
  ): { contourId: any; pointId: any; pointIndex: number } | null {
    const snapshot = this.ctx.edit.getGlyph();
    if (!snapshot) return null;

    const activeContourId = this.ctx.edit.getActiveContourId();
    const hitRadius = this.ctx.screen.hitRadius;

    for (const contour of snapshot.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (contour.points.length < 3) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        const dist = Vec2.dist(pos, point);
        if (dist < hitRadius) {
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

  render(renderer: IRenderer): void {
    if (this.ctx.zone.getZone() !== "canvas") return;

    if (this.state.type === "ready") {
      const lastPoint = this.getLastOnCurvePoint();
      if (!lastPoint) return;

      renderer.setStyle(PREVIEW_LINE_STYLE);
      renderer.lineWidth = this.ctx.screen.lineWidth(PREVIEW_LINE_STYLE.lineWidth);
      renderer.beginPath();
      renderer.moveTo(lastPoint.x, lastPoint.y);
      renderer.lineTo(this.state.mousePos.x, this.state.mousePos.y);
      renderer.stroke();
    }

    if (this.state.type === "dragging") {
      const { anchor, mousePos } = this.state;

      renderer.setStyle(DEFAULT_STYLES);
      renderer.lineWidth = this.ctx.screen.lineWidth(DEFAULT_STYLES.lineWidth);

      const anchorX = anchor.position.x;
      const anchorY = anchor.position.y;
      const mouseX = mousePos.x;
      const mouseY = mousePos.y;

      const mirrorPos = Vec2.mirror(mousePos, anchor.position);

      renderer.beginPath();
      renderer.moveTo(mouseX, mouseY);
      renderer.lineTo(anchorX, anchorY);
      renderer.stroke();

      renderer.beginPath();
      renderer.moveTo(anchorX, anchorY);
      renderer.lineTo(mirrorPos.x, mirrorPos.y);
      renderer.stroke();

      drawHandle(renderer, "control", mouseX, mouseY, "idle");
      drawHandle(renderer, "control", mirrorPos.x, mirrorPos.y, "idle");
    }
  }
}
