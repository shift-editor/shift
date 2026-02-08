import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, defineStateDiagram, DrawAPI, ToolEvent } from "../core";
import { executeAction, type PenAction } from "./actions";
import type { PenState, PenBehavior } from "./types";
import { PlaceBehavior, HandleBehavior, EscapeBehavior } from "./behaviors";
import { DEFAULT_STYLES, PEN_READY_STYLE, PREVIEW_LINE_STYLE } from "../../styles/style";
import type { CursorType } from "@/types/editor";
import { isContourEndpointHit, isMiddlePointHit, isSegmentHit } from "@/types/hitResult";

export type { PenState };

export class Pen extends BaseTool<PenState, PenAction> {
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

  readonly behaviors: PenBehavior[] = [
    new EscapeBehavior(),
    new PlaceBehavior(),
    new HandleBehavior(),
  ];

  getCursor(state: PenState): CursorType {
    if (state.type !== "ready") return { type: "pen" };

    const pos = state.mousePos;

    if (this.hasActiveDrawingContour()) {
      if (this.shouldCloseContour(pos.x, pos.y)) {
        return { type: "pen-end" };
      }
      return { type: "pen" };
    }

    const hit = this.editor.getNodeAt(pos);
    if (isContourEndpointHit(hit) && !hit.contour.closed) return { type: "pen-end" };
    if (isMiddlePointHit(hit)) return { type: "pen-end" };
    if (isSegmentHit(hit)) return { type: "pen-add" };

    return { type: "pen" };
  }

  initialState(): PenState {
    return { type: "idle" };
  }

  activate(): void {
    const pos = this.editor.getMousePosition();
    this.state = { type: "ready", mousePos: pos };
    this.editor.clearActiveContour();
  }

  deactivate(): void {
    this.state = this.initialState();
  }

  protected preTransition(state: PenState, event: ToolEvent) {
    if (state.type === "ready" && event.type === "pointerMove") {
      return { state: { type: "ready" as const, mousePos: event.point } };
    }
    return null;
  }

  protected executeAction(action: PenAction, prev: PenState): void {
    switch (action.type) {
      case "close":
        this.batch("Close Contour", () => {
          executeAction(action, this.editor);
        });
        break;

      case "continue":
        this.batch("Continue Contour", () => {
          executeAction(action, this.editor);
        });
        break;

      case "splitPoint":
        this.batch("Split Contour", () => {
          executeAction(action, this.editor);
        });
        break;

      case "splitSegment":
        this.batch("Split Segment", () => {
          executeAction(action, this.editor);
        });
        break;

      case "placePoint":
        if (prev.type === "ready") {
          this.batch("Add Point", () => {
            const pointId = executeAction(action, this.editor);
            if (this.state.type === "anchored") {
              (this.state as any).anchor.pointId = pointId;
            }
          });
        }
        break;

      case "abandonContour":
        this.batch("Abandon Contour", () => {
          executeAction(action, this.editor);
        });
        break;

      case "updateHover":
        executeAction(action, this.editor);
        break;
    }
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const contour = this.editor.getActiveContour();
    if (!contour || contour.closed || contour.points.length < 2) {
      return false;
    }

    const firstPoint = Contours.firstPoint(contour);
    if (!firstPoint) return false;

    return Vec2.isWithin({ x, y }, firstPoint, this.editor.hitRadius);
  }

  private hasActiveDrawingContour(): boolean {
    const contour = this.editor.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }

  private getLastOnCurvePoint(): Point2D | null {
    const contour = this.editor.getActiveContour();
    if (!contour || Contours.isEmpty(contour) || contour.closed) {
      return null;
    }

    const lastOnCurve = Contours.lastOnCurvePoint(contour);
    if (!lastOnCurve) return null;

    return { x: lastOnCurve.x, y: lastOnCurve.y };
  }

  renderBelowHandles(draw: DrawAPI): void {
    if (this.editor.getFocusZone() !== "canvas") return;

    if (this.state.type === "ready") {
      const lastPoint = this.getLastOnCurvePoint();
      if (!lastPoint) return;

      draw.line(lastPoint, this.state.mousePos, {
        strokeStyle: PREVIEW_LINE_STYLE.strokeStyle,
        strokeWidth: PREVIEW_LINE_STYLE.lineWidth,
      });
    }

    if (this.state.type === "dragging") {
      const { anchor, mousePos, snappedPos } = this.state;
      const effectivePos = snappedPos ?? mousePos;
      const mirrorPos = Vec2.mirror(effectivePos, anchor.position);

      const style = {
        strokeStyle: DEFAULT_STYLES.strokeStyle,
        strokeWidth: DEFAULT_STYLES.lineWidth,
      };

      draw.line(effectivePos, anchor.position, style);
      draw.line(anchor.position, mirrorPos, style);
    }
  }

  render(draw: DrawAPI): void {
    if (this.editor.getFocusZone() !== "canvas") return;

    if (this.state.type === "ready") {
      draw.circle(this.state.mousePos, PEN_READY_STYLE.size, {
        strokeStyle: PEN_READY_STYLE.strokeStyle,
        strokeWidth: PEN_READY_STYLE.lineWidth,
        fillStyle: PEN_READY_STYLE.fillStyle,
      });
    }

    if (this.state.type === "dragging") {
      const { anchor, mousePos, snappedPos } = this.state;
      const effectivePos = snappedPos ?? mousePos;
      const mirrorPos = Vec2.mirror(effectivePos, anchor.position);

      draw.handle(effectivePos, "control", "idle");
      draw.handle(mirrorPos, "control", "idle");
    }
  }
}
