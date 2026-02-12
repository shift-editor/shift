import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram, DrawAPI } from "../core";
import { edgeToCursor, boundingBoxHitResultToCursor, type BoundingRectEdge } from "./cursor";
import type { SelectState, SelectBehavior } from "./types";
import { executeAction, type SelectAction } from "./actions";
import {
  SelectionBehavior,
  MarqueeBehavior,
  TranslateBehavior,
  ResizeBehavior,
  RotateBehavior,
  NudgeBehavior,
  EscapeBehavior,
  ToggleSmoothBehavior,
  UpgradeSegmentBehavior,
  DoubleClickSelectContourBehavior,
} from "./behaviors";
import { TextRunEditBehavior } from "./behaviors/TextRunEditBehavior";
import { TextRunHoverBehavior } from "./behaviors/TextRunHoverBehavior";
import { normalizeRect } from "./utils";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import type { CursorType } from "@/types/editor";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState, SelectAction> {
  static stateSpec = defineStateDiagram<SelectState["type"]>({
    states: ["idle", "ready", "selecting", "selected", "translating", "resizing", "rotating"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "selecting", event: "marquee" },
      { from: "ready", to: "selected", event: "click" },
      { from: "selecting", to: "selected", event: "release" },
      { from: "selected", to: "translating", event: "drag" },
      { from: "translating", to: "selected", event: "release" },
      { from: "selected", to: "ready", event: "escape" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "select";

  readonly behaviors: SelectBehavior[] = [
    new TextRunHoverBehavior(),
    new TextRunEditBehavior(),
    new DoubleClickSelectContourBehavior(),
    new ToggleSmoothBehavior(),
    new UpgradeSegmentBehavior(),
    new SelectionBehavior(),
    new NudgeBehavior(),
    new EscapeBehavior(),
    new ResizeBehavior(),
    new RotateBehavior(),
    new TranslateBehavior(),
    new MarqueeBehavior(),
  ];

  getCursor(state: SelectState): CursorType {
    if (state.type === "translating") return { type: "move" };
    if (state.type === "resizing") return edgeToCursor(state.resize.edge);
    if (state.type === "rotating") {
      return boundingBoxHitResultToCursor({
        type: "rotate",
        corner: state.rotate.corner,
      });
    }

    const bbHandle = this.editor.getHoveredBoundingBoxHandle();
    if (bbHandle) return boundingBoxHitResultToCursor(bbHandle);

    if (this.editor.getCurrentModifiers().altKey && this.editor.getIsHoveringNode()) {
      return { type: "copy" };
    }

    return { type: "default" };
  }

  initialState(): SelectState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = { type: "ready" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }

  protected preTransition(state: SelectState, event: ToolEvent) {
    if (event.type === "selectionChanged") {
      const hasSelection = this.editor.hasSelection();
      if (hasSelection && state.type === "ready") {
        return { state: { type: "selected" as const } };
      }
      if (!hasSelection && state.type === "selected") {
        return { state: { type: "ready" as const } };
      }
      return { state };
    }
    return null;
  }

  protected executeAction(action: SelectAction): void {
    executeAction(action, this.editor);
  }

  render(draw: DrawAPI): void {
    if (this.state.type !== "selecting") return;
    const rect = normalizeRect(this.state.selection.startPos, this.state.selection.currentPos);
    draw.rect(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      {
        fillStyle: SELECTION_RECTANGLE_STYLES.fillStyle,
        strokeStyle: SELECTION_RECTANGLE_STYLES.strokeStyle,
        strokeWidth: SELECTION_RECTANGLE_STYLES.lineWidth,
      },
    );
  }
}
