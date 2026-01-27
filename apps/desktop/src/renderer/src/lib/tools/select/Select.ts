import type { IRenderer } from "@/types/graphics";
import { BaseTool, type ToolName, type ToolEvent } from "../core";
import { getCursorForState, type BoundingRectEdge } from "./cursor";
import type { SelectState, SelectBehavior } from "./types";
import { executeIntent } from "./intents";
import {
  HoverBehavior,
  SelectionBehavior,
  MarqueeBehavior,
  DragBehavior,
  ResizeBehavior,
  NudgeBehavior,
} from "./behaviors";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState> {
  readonly id: ToolName = "select";

  private behaviors: SelectBehavior[] = [
    new HoverBehavior(),
    new SelectionBehavior(),
    new NudgeBehavior(),
    new ResizeBehavior(),
    new DragBehavior(),
    new MarqueeBehavior(),
  ];

  initialState(): SelectState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = { type: "ready", hoveredPointId: null };
    this.ctx.cursor.set({ type: "default" });
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

  transition(state: SelectState, event: ToolEvent): SelectState {
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

    return this.handleDoubleClick(state, event);
  }

  private handleDoubleClick(state: SelectState, event: ToolEvent): SelectState {
    if (event.type === "doubleClick" && (state.type === "ready" || state.type === "selected")) {
      const point = this.ctx.hitTest.getPointAt(event.point);
      const pointId = this.ctx.hitTest.getPointIdAt(event.point);
      if (point && pointId && point.pointType === "onCurve") {
        return {
          ...state,
          intent: { action: "toggleSmooth", pointId },
        };
      }
    }
    return state;
  }

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
    if (next.intent) {
      executeIntent(next.intent, this.ctx);
    }

    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.ctx);
    }

    this.updateCursorForState(next, event);
  }

  private updateCursorForState(state: SelectState, event: ToolEvent): void {
    const cursor = getCursorForState(state, event, {
      hitTest: this.ctx.hitTest,
      hitTestBoundingRectEdge: (pos) => this.hitTestBoundingRectEdge(pos),
    });
    this.ctx.cursor.set(cursor);
  }

  private hitTestBoundingRectEdge(pos: { x: number; y: number }): BoundingRectEdge {
    const rect = this.ctx.hitTest.getSelectionBoundingRect();
    if (!rect) return null;

    const tolerance = this.ctx.screen.hitRadius;

    const onLeft = Math.abs(pos.x - rect.left) < tolerance;
    const onRight = Math.abs(pos.x - rect.right) < tolerance;
    const onTop = Math.abs(pos.y - rect.top) < tolerance;
    const onBottom = Math.abs(pos.y - rect.bottom) < tolerance;

    const withinX = pos.x >= rect.left - tolerance && pos.x <= rect.right + tolerance;
    const withinY = pos.y >= rect.top - tolerance && pos.y <= rect.bottom + tolerance;

    if (onLeft && onTop) return "bottom-left";
    if (onRight && onTop) return "bottom-right";
    if (onLeft && onBottom) return "top-left";
    if (onRight && onBottom) return "top-right";

    if (onLeft && withinY) return "left";
    if (onRight && withinY) return "right";
    if (onTop && withinX) return "top";
    if (onBottom && withinX) return "bottom";

    return null;
  }

  render(renderer: IRenderer): void {
    for (const behavior of this.behaviors) {
      behavior.render?.(renderer, this.state, this.ctx);
    }
  }
}
