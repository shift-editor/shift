import type { IRenderer } from "@/types/graphics";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram } from "../core";
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
  EscapeBehavior,
  ToggleSmoothBehavior,
  UpgradeSegmentBehavior,
  DoubleClickSelectContourBehavior,
} from "./behaviors";
import { hitTestBoundingBox } from "./boundingBoxHitTest";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState> {
  static stateSpec = defineStateDiagram<SelectState["type"]>({
    states: ["idle", "ready", "selecting", "selected", "dragging", "resizing", "rotating"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "selecting", event: "marquee" },
      { from: "ready", to: "selected", event: "click" },
      { from: "selecting", to: "selected", event: "release" },
      { from: "selected", to: "dragging", event: "drag" },
      { from: "dragging", to: "selected", event: "release" },
      { from: "selected", to: "ready", event: "escape" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "select";

  private behaviors: SelectBehavior[] = [
    new HoverBehavior(),
    new DoubleClickSelectContourBehavior(),
    new ToggleSmoothBehavior(),
    new UpgradeSegmentBehavior(),
    new SelectionBehavior(),
    new NudgeBehavior(),
    new EscapeBehavior(),
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
    this.editor.cursor.set({ type: "default" });
  }

  deactivate(): void {
    this.state = { type: "idle" };
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

  transition(state: SelectState, event: ToolEvent): SelectState {
    if (state.type === "idle") {
      return state;
    }

    if (event.type === "selectionChanged") {
      const hasSelection = this.editor.hasSelection();
      if (hasSelection && state.type === "ready") {
        return { type: "selected", hoveredPointId: null };
      }
      if (!hasSelection && state.type === "selected") {
        return { type: "ready", hoveredPointId: null };
      }
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

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
    if (next.intent) {
      executeIntent(next.intent, this.editor);
    }

    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.editor);
    }

    this.updateCursorForState(next, event);
  }

  private updateCursorForState(state: SelectState, event: ToolEvent): void {
    const hitResult = event && "point" in event ? this.hitTestBoundingBox(event.point) : null;
    this.editor.hover.setHoveredBoundingBoxHandle(hitResult);

    const cursor = getCursorForState(state, event, {
      hitTest: this.editor.hitTest,
      hitTestBoundingBox: (pos) => this.hitTestBoundingBox(pos),
    });
    this.editor.cursor.set(cursor);
  }

  private hitTestBoundingBox(pos: { x: number; y: number }): BoundingBoxHitResult {
    const rect = this.editor.hitTest.getSelectionBoundingRect();
    if (!rect) return null;

    const hitRadius = this.editor.screen.hitRadius;
    const handleOffset = this.editor.screen.toUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = this.editor.screen.toUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    return hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
  }

  render(renderer: IRenderer): void {
    for (const behavior of this.behaviors) {
      behavior.render?.(renderer, this.state, this.editor);
    }
  }
}
