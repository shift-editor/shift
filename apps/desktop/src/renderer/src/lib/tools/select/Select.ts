import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram, DrawAPI } from "../core";
import { edgeToCursor, boundingBoxHitResultToCursor, type BoundingRectEdge } from "./cursor";
import type { SelectState, SelectBehavior } from "./types";
import { executeIntent } from "./intents";
import {
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
import { computed, type ComputedSignal } from "@/lib/reactive/signal";
import type { CursorType } from "@/types/editor";
import type { Editor } from "@/lib/editor";

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
  readonly $cursor: ComputedSignal<CursorType>;

  private behaviors: SelectBehavior[] = [
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

  constructor(editor: Editor) {
    super(editor);

    this.$cursor = computed<CursorType>(() => {
      const state = this.editor.activeToolState.value as SelectState;

      if (state.type === "dragging") return { type: "move" };
      if (state.type === "resizing") return edgeToCursor(state.resize.edge);
      if (state.type === "rotating") {
        return boundingBoxHitResultToCursor({
          type: "rotate",
          corner: state.rotate.corner,
        });
      }

      const bbHandle = this.editor.hoveredBoundingBoxHandle.value;
      if (bbHandle) return boundingBoxHitResultToCursor(bbHandle);

      return { type: "default" };
    });
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

  transition(state: SelectState, event: ToolEvent): SelectState {
    if (state.type === "idle") {
      return state;
    }

    if (event.type === "selectionChanged") {
      const hasSelection = this.editor.hasSelection();
      if (hasSelection && state.type === "ready") {
        return { type: "selected" };
      }
      if (!hasSelection && state.type === "selected") {
        return { type: "ready" };
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
  }

  render(draw: DrawAPI): void {
    for (const behavior of this.behaviors) {
      behavior.render?.(draw, this.state, this.editor);
    }
  }
}
