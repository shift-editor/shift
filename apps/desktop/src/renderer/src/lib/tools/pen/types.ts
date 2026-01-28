import type { Point2D, PointId } from "@shift/types";
import type { ToolEvent } from "../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { IRenderer } from "@/types/graphics";
import type { PenIntent } from "./intents";

export interface AnchorData {
  position: Point2D;
  pointId: PointId;
  context: ContourContext;
}

export interface HandleData {
  cpIn?: PointId;
  cpOut?: PointId;
}

export interface ContourContext {
  previousPointType: "none" | "onCurve" | "offCurve";
  previousOnCurvePosition: Point2D | null;
  isFirstPoint: boolean;
}

export type PenState =
  | { type: "idle"; intent?: PenIntent }
  | { type: "ready"; mousePos: Point2D; intent?: PenIntent }
  | { type: "anchored"; anchor: AnchorData; intent?: PenIntent }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
      intent?: PenIntent;
    };

export interface PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean;
  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null;
  onTransition?(prev: PenState, next: PenState, event: ToolEvent, editor: Editor): void;
  render?(renderer: IRenderer, state: PenState, editor: Editor): void;
}
