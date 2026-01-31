import { Vec2 } from "@shift/geo";
import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram, DrawAPI } from "../core";
import { executeIntent, type PenIntent } from "./intents";
import type { PenState, PenBehavior } from "./types";
import { HoverBehavior, PlaceBehavior, HandleBehavior, EscapeBehavior } from "./behaviors";
import { DEFAULT_STYLES, PEN_READY_STYLE, PREVIEW_LINE_STYLE } from "../../styles/style";

export type { PenState };

export class Pen extends BaseTool<PenState> {
  static stateSpec = defineStateDiagram<PenState["type"]>({
    states: ["idle", "ready", "anchored", "dragging"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "anchored", event: "click" },
      { from: "anchored", to: "dragging", event: "drag" },
      { from: "dragging", to: "anchored", event: "release" },
      { from: "anchored", to: "ready", event: "commit" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

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
    const pos = this.editor.screenMousePosition;
    this.state = { type: "ready", mousePos: pos };
    this.editor.cursor.set({ type: "pen" });
    this.editor.edit.clearActiveContour();
  }

  deactivate(): void {
    this.state = this.initialState();
  }

  handleModifier(key: string, pressed: boolean): boolean {
    if (key === "Space") {
      if (pressed) {
        this.editor.tools.requestTemporary("hand", {
          onActivate: () => this.editor.render.setPreviewMode(true),
          onReturn: () => this.editor.render.setPreviewMode(false),
        });
      } else {
        this.editor.tools.returnFromTemporary();
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
        const result = behavior.transition(state, event, this.editor);
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
      behavior.onTransition?.(prev, next, event, this.editor);
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
          executeIntent(intent, this.editor);
        });
        break;

      case "continue":
        this.batch("Continue Contour", () => {
          executeIntent(intent, this.editor);
        });
        break;

      case "splitPoint":
        this.batch("Split Contour", () => {
          executeIntent(intent, this.editor);
        });
        break;

      case "splitSegment":
        this.batch("Split Segment", () => {
          executeIntent(intent, this.editor);
        });
        break;

      case "placePoint":
        if (prev.type === "ready") {
          this.batch("Add Point", () => {
            const pointId = executeIntent(intent, this.editor);
            if (this.state.type === "anchored") {
              (this.state as any).anchor.pointId = pointId;
            }
          });
        }
        break;

      case "abandonContour":
        this.batch("Abandon Contour", () => {
          executeIntent(intent, this.editor);
        });
        break;

      case "setCursor":
        executeIntent(intent, this.editor);
        break;

      case "updateHover":
        executeIntent(intent, this.editor);
        break;
    }
  }

  private updateCursorForPosition(pos: Point2D): void {
    if (this.hasActiveDrawingContour()) {
      if (this.shouldCloseContour(pos.x, pos.y)) {
        this.editor.cursor.set({ type: "pen-end" });
        return;
      }
      this.editor.cursor.set({ type: "pen" });
      return;
    }

    const endpoint = this.editor.hitTest.getContourEndpointAt(pos);
    if (endpoint && !endpoint.contour.closed) {
      this.editor.cursor.set({ type: "pen-end" });
      return;
    }

    const middlePoint = this.getMiddlePointAt(pos);
    if (middlePoint) {
      this.editor.cursor.set({ type: "pen-end" });
      return;
    }

    const segmentHit = this.editor.hitTest.getSegmentAt(pos);
    if (segmentHit) {
      this.editor.cursor.set({ type: "pen-add" });
      return;
    }

    this.editor.cursor.set({ type: "pen" });
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const glyph = this.editor.edit.getGlyph();
    const activeContourId = this.editor.edit.getActiveContourId();
    const activeContour = glyph?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = activeContour.points[0];
    return Vec2.isWithin({ x, y }, firstPoint, this.editor.hitRadius);
  }

  private hasActiveDrawingContour(): boolean {
    const glyph = this.editor.edit.getGlyph();
    if (!glyph) return false;

    const activeContourId = this.editor.edit.getActiveContourId();
    const activeContour = glyph.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }

  private getLastOnCurvePoint(): Point2D | null {
    const glyph = this.editor.edit.getGlyph();
    if (!glyph) return null;

    const activeContourId = this.editor.edit.getActiveContourId();
    const activeContour = glyph.contours.find((c) => c.id === activeContourId);

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
    const glyph = this.editor.edit.getGlyph();
    if (!glyph) return null;

    const activeContourId = this.editor.edit.getActiveContourId();
    const hitRadius = this.editor.hitRadius;

    for (const contour of glyph.contours) {
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

  render(draw: DrawAPI): void {
    if (this.editor.zone.getZone() !== "canvas") return;

    if (this.state.type === "ready") {
      draw.circle(this.state.mousePos, PEN_READY_STYLE.size, {
        strokeStyle: PEN_READY_STYLE.strokeStyle,
        strokeWidth: PEN_READY_STYLE.lineWidth,
        fillStyle: PEN_READY_STYLE.fillStyle,
      });

      const lastPoint = this.getLastOnCurvePoint();
      if (!lastPoint) return;

      draw.line(lastPoint, this.state.mousePos, {
        strokeStyle: PREVIEW_LINE_STYLE.strokeStyle,
        strokeWidth: PREVIEW_LINE_STYLE.lineWidth,
      });
    }

    if (this.state.type === "dragging") {
      const { anchor, mousePos } = this.state;
      const mirrorPos = Vec2.mirror(mousePos, anchor.position);

      const style = {
        strokeStyle: DEFAULT_STYLES.strokeStyle,
        strokeWidth: DEFAULT_STYLES.lineWidth,
      };

      draw.line(mousePos, anchor.position, style);
      draw.line(anchor.position, mirrorPos, style);

      draw.handle(mousePos, "control", "idle");
      draw.handle(mirrorPos, "control", "idle");
    }
  }
}
