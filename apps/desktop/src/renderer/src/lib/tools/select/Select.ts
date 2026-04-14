import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram } from "../core";
import { edgeToCursor, boundingBoxHitResultToCursor, type BoundingRectEdge } from "./cursor";
import type { SelectState, SelectBehavior } from "./types";
import {
  Selection,
  Marquee,
  Translate,
  Resize,
  Rotate,
  Nudge,
  Escape,
  ToggleSmooth,
  UpgradeSegment,
  BendCurve,
  ContourDoubleClick,
} from "./behaviors";
import { TextRunHover } from "./behaviors/TextRunHover";
import { normalizeRect } from "./utils";
import type { CursorType } from "@/types/editor";
import { TextRunEdit } from "./behaviors/TextRunEdit";
import type { Canvas } from "@/lib/editor/rendering/Canvas";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState> {
  static stateSpec = defineStateDiagram<SelectState["type"]>({
    states: [
      "idle",
      "ready",
      "selecting",
      "selected",
      "translating",
      "resizing",
      "rotating",
      "bending",
    ],
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
    new ToggleSmooth(),
    new ContourDoubleClick(),
    new TextRunHover(),
    new TextRunEdit(),
    new UpgradeSegment(),
    new Selection(),
    new Nudge(),
    new Escape(),
    new Resize(),
    new Rotate(),
    new BendCurve(),
    new Translate(),
    new Marquee(),
  ];

  override getCursor(state: SelectState): CursorType {
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

  override activate(): void {
    this.state = { type: "ready" };
  }

  override deactivate(): void {
    this.state = { type: "idle" };
  }

  protected override preTransition(state: SelectState, event: ToolEvent) {
    if (event.type === "selectionChanged") {
      const hasSelection = this.editor.selection.hasSelection();
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

  override renderOverlay(canvas: Canvas): void {
    if (this.state.type !== "selecting") return;
    const rect = normalizeRect(this.state.selection.startPos, this.state.selection.currentPos);
    canvas.fillRect(rect.x, rect.y, rect.width, rect.height, canvas.theme.selection.fill);
    canvas.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      canvas.theme.selection.stroke,
      canvas.theme.selection.widthPx,
    );
  }
}
