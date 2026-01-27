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
  RotateBehavior,
  NudgeBehavior,
} from "./behaviors";
import { hitTestBoundingBox } from "./boundingBoxHitTest";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState> {
  readonly id: ToolName = "select";

  private behaviors: SelectBehavior[] = [
    new HoverBehavior(),
    new SelectionBehavior(),
    new NudgeBehavior(),
    new ResizeBehavior(),
    new RotateBehavior(),
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
      if (point && point.pointType === "onCurve") {
        return {
          ...state,
          intent: { action: "toggleSmooth", pointId: point.id },
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
    const hitResult = event && "point" in event ? this.hitTestBoundingBox(event.point) : null;
    this.ctx.hover.setHoveredBoundingBoxHandle(hitResult);

    const cursor = getCursorForState(state, event, {
      hitTest: this.ctx.hitTest,
      hitTestBoundingBox: (pos) => this.hitTestBoundingBox(pos),
    });
    this.ctx.cursor.set(cursor);
  }

  private hitTestBoundingBox(pos: { x: number; y: number }): BoundingBoxHitResult {
    const rect = this.ctx.hitTest.getSelectionBoundingRect();
    if (!rect) return null;

    const hitRadius = this.ctx.screen.hitRadius;
    const handleOffset = this.ctx.screen.toUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = this.ctx.screen.toUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    return hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
  }

  render(renderer: IRenderer): void {
    for (const behavior of this.behaviors) {
      behavior.render?.(renderer, this.state, this.ctx);
    }
  }
}
