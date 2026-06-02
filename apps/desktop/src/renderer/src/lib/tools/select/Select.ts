import { BaseTool, type ToolName } from "../core";
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
import { TextRunEdit } from "./behaviors/TextRunEdit";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { SelectBoundingBox } from "./BoundingBox";
import { SelectMarquee } from "./Marquee";
import { SelectSegments } from "./Segments";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState, Select> {
  readonly id: ToolName = "select";
  readonly boundingBox = new SelectBoundingBox(this);
  readonly marquee = new SelectMarquee(this);
  readonly #segments = new SelectSegments();

  readonly behaviors: SelectBehavior[] = [
    new ToggleSmooth(),
    new SegmentDoubleClick(),
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
    new SelectHover(),
  ];

  override getCursor(state: SelectState): CursorType {
    if (state.type === "translating") return { type: "move" };
    if (state.type === "resizing") return edgeToCursor(state.resize.edge);
    if (state.type === "rotating") {
      return this.boundingBox.cursorForRotationCorner(state.rotate.corner);
    }

    const coords = this.editor.input.pointerCell.value;
    if (coords) {
      const cursor = this.boundingBox.cursor(coords);
      if (cursor) return cursor;
    }

    const modifiers = this.editor.input.modifiersCell.value;
    const hover = this.editor.hover.targetCell.value;
    if (modifiers.altKey && hover) {
      return { type: "copy" };
    }

    return { type: "default" };
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
    const display = this.editor.glyphDisplay;
    if (display.proofMode || !display.editableGlyphVisible) return;

    const instance = this.editor.glyphInstance;
    if (!instance) return;

    this.#segments.draw(canvas, instance.geometry, this.editor.selection, this.editor.hover);
  }

  override drawOverlay(canvas: Canvas): void {
    // TODO: perhaps there should be a way for tools to turn on/off bounding box
    // rendering without it having to be a commit in the Select Tool
    const otherToolState = this.editor.getActiveToolState().type;
    const isMutatingState =
      this.state.type === "translating" ||
      this.state.type === "resizing" ||
      this.state.type === "rotating" ||
      otherToolState === "bend";

    if (!isMutatingState) {
      this.boundingBox.draw(canvas);
    }

    this.marquee.draw(canvas);
  }
}
