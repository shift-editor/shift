import { BaseTool, type ToolEvent, type ToolName } from "../core";
import { edgeToCursor, type BoundingRectEdge } from "./cursor";
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
  SelectHover,
  SegmentDoubleClick,
} from "./behaviors";
import { TextRunHover } from "./behaviors/TextRunHover";
import type { CursorType } from "@/types/editor";
import { objectIsKindOf } from "@/types";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { SelectBoundingBox } from "./BoundingBox";
import { SelectMarquee } from "./Marquee";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState, Select> {
  readonly id: ToolName = "select";
  readonly boundingBox = new SelectBoundingBox(this);
  readonly marquee = new SelectMarquee(this);

  readonly behaviors: SelectBehavior[] = [
    new ToggleSmooth(),
    new SegmentDoubleClick(),
    new TextRunHover(),
    new UpgradeSegment(),
    new Selection(),
    new Nudge(),
    new Escape(),
    new Resize(),
    new Rotate(),
    new BendCurve(),
    new Translate(),
    new Marquee(),
    new SelectHover(),
  ];

  override getCursor(state: SelectState): CursorType {
    if (this.editor.sessionMode === "preview") return { type: "default" };

    switch (state.type) {
      case "translating":
        return { type: "move" };
      case "resizing":
        return edgeToCursor(state.resize.edge);
      case "rotating":
        return this.boundingBox.cursorForRotationCorner(state.rotate.corner);
      case "bending":
        return { type: "bend" };
    }

    const coords = this.editor.input.pointerCell.value;
    if (coords) {
      const cursor = this.boundingBox.cursor(coords);
      if (cursor) return cursor;
    }

    const modifiers = this.editor.input.modifiersCell.value;
    const hover = this.editor.hover.entryCell.value;
    if (state.type === "ready" && coords && modifiers.metaKey && hover) {
      const object = this.editor.object(hover);
      if (objectIsKindOf(object, "segment")) {
        const layer = object.layer;
        if (
          layer &&
          layer.sourceId === this.editor.activeSourceIdCell.value &&
          layer.segment(object.segmentId)?.asCubic()
        ) {
          return { type: "bend" };
        }
      }
    }

    if (coords && this.boundingBox.containsTranslationPoint(coords)) return { type: "move" };

    if (modifiers.altKey && hover) {
      return { type: "copy" };
    }

    return { type: "default" };
  }

  protected override preTransition(
    state: SelectState,
    event: ToolEvent,
  ): { state: SelectState } | null {
    if (this.editor.sessionMode !== "preview") return null;

    switch (event.type) {
      case "click":
      case "doubleClick":
        switch (event.target.kind) {
          case "point":
          case "segment":
          case "anchor":
            this.editor.notifyPreviewMutationAttempt();
        }

        return { state };

      case "pointerMove":
        this.editor.hover.clear();
        return { state };

      case "dragStart":
        this.editor.selection.clear();
        return {
          state: {
            type: "brushing",
            selection: { startPos: event.origin.scene, currentPos: event.coords.scene },
          },
        };

      case "keyDown":
        return event.key === "Escape" ? null : { state };

      default:
        return null;
    }
  }

  protected override isEditing(state: SelectState): boolean {
    return (
      state.type === "translating" ||
      state.type === "resizing" ||
      state.type === "rotating" ||
      state.type === "bending"
    );
  }

  initialState(): SelectState {
    return { type: "idle" };
  }

  override activate(): void {
    this.setState({ type: "ready" });
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
  }

  override drawScene(canvas: Canvas): void {
    void canvas;
  }

  override drawOverlay(canvas: Canvas): void {
    // TODO: perhaps there should be a way for tools to turn on/off bounding box
    // rendering without it having to be a commit in the Select Tool
    if (this.editor.sessionMode !== "preview" && !this.isEditing(this.state)) {
      this.boundingBox.draw(canvas);
    }

    this.marquee.draw(canvas);
  }
}
