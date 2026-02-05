import { Vec2, Contours } from "@shift/geo";
import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram, DrawAPI } from "../core";
import { executeIntent, type PenIntent } from "./intents";
import type { PenState, PenBehavior } from "./types";
import { PlaceBehavior, HandleBehavior, EscapeBehavior } from "./behaviors";
import { DEFAULT_STYLES, PEN_READY_STYLE, PREVIEW_LINE_STYLE } from "../../styles/style";
import type { CursorType } from "@/types/editor";
import { isContourEndpointHit, isMiddlePointHit, isSegmentHit } from "@/types/hitResult";

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

  handleModifier(key: string, pressed: boolean): boolean {
    if (key === "Space") {
      if (pressed) {
        this.editor.requestTemporaryTool("hand", {
          onActivate: () => this.editor.setPreviewMode(true),
          onReturn: () => this.editor.setPreviewMode(false),
        });
      } else {
        this.editor.returnFromTemporaryTool();
      }
      return true;
    }
    return false;
  }

  transition(state: PenState, event: ToolEvent): PenState {
    if (state.type === "idle") {
      return state;
    }

    if (state.type === "ready" && event.type === "pointerMove") {
      return { type: "ready", mousePos: event.point };
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

      case "updateHover":
        executeIntent(intent, this.editor);
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
