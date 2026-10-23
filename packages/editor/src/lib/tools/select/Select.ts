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
  NodeDoubleClick,
  FitToContent,
} from "./behaviors";
import { isNodeId, type SelectableId } from "@shift/types";
import { track } from "../../signals/index";
import type { CursorType } from "../../../types/editor";
import { objectIsKindOf, type ShiftObject } from "../../../types/object";
import type { Canvas } from "../../editor/rendering/Canvas";
import { SnapLines } from "../../editor/rendering/overlays/SnapLines";
import { SelectBoundingBox } from "./BoundingBox";
import { SelectMarquee } from "./Marquee";
import { SelectUpgradePreview } from "./SelectUpgradePreview";
import { EndpointDrop } from "./EndpointDrop";

export type { BoundingRectEdge, SelectState };

export class Select extends BaseTool<SelectState, Select> {
  readonly id: ToolName = "select";
  readonly boundingBox = new SelectBoundingBox(this);
  readonly marquee = new SelectMarquee(this);
  readonly upgradePreview = new SelectUpgradePreview(this);
  readonly #snapLines = new SnapLines();

  readonly behaviors: SelectBehavior[] = [
    new ToggleSmooth(),
    new SegmentDoubleClick(),
    new FitToContent(),
    new NodeDoubleClick(),
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

  /** Whether releasing the current drag would close or join contours at an open end. */
  #dropsOnOpenEnd(): boolean {
    const drop = EndpointDrop.fromSelection(this.editor);
    if (!drop) return false;

    return drop.targetWithin(this.editor.hitRadius) !== null;
  }

  /** Whether Alt is held with text boxes selected, so dragging moves copies. */
  #copiesTextBoxes(): boolean {
    const { modifiersCell } = this.editor.input;
    const selection = this.editor.selection.stateCell;
    track(modifiersCell);
    track(selection);
    if (!modifiersCell.peek().altKey) return false;
    return selection.peek().ids.some((id) => this.#isTextBox(id));
  }

  #isTextBox(id: SelectableId): boolean {
    return isNodeId(id) && this.editor.scene.nodeOfKind(id, "textRun") !== null;
  }

  override getCursor(state: SelectState): CursorType {
    if (this.editor.sessionMode === "preview") return { type: "default" };

    switch (state.type) {
      case "translating":
        if (this.#copiesTextBoxes()) return { type: "copy" };
        return this.#dropsOnOpenEnd() ? { type: "end" } : { type: "move" };
      case "resizing":
        return edgeToCursor(state.resize.edge, state.resize.flipX, state.resize.flipY);
      case "rotating":
        return this.boundingBox.cursorForRotationCorner(state.rotate.corner);
      case "bending":
        return { type: "bend" };
    }

    const coords = this.editor.input.pointerCell.value;
    const modifiers = this.editor.input.modifiersCell.value;
    const hover = this.editor.hover.entryCell.value;
    const selectedIds = this.editor.selection.stateCell.value.ids;
    // Shift-click only adds when there is a selection to add to.
    const addsToSelection =
      state.type === "ready" &&
      coords &&
      modifiers.shiftKey &&
      hover &&
      selectedIds.length > 0 &&
      shiftClickAddable(this.editor.object(hover)) &&
      !selectedIds.includes(hover);
    if (addsToSelection) return { type: "add" };

    if (state.type === "ready" && coords && modifiers.metaKey && hover) {
      const object = this.editor.object(hover);
      if (objectIsKindOf(object, "segment")) {
        const layer = object.layer;
        const segment = layer?.geometryCell.value.segment(object.segmentId);
        if (
          layer &&
          layer.sourceId === this.editor.activeSourceIdCell.value &&
          segment?.type === "line"
        ) {
          return { type: "bend" };
        }
      }
    }

    if (coords) {
      const cursor = this.boundingBox.cursor(coords);
      if (cursor) return cursor;
    }

    // Alt over a text box, or inside a selected one: a drag would move a copy.
    if (state.type === "ready" && coords && modifiers.altKey) {
      const overBox = hover !== null && this.#isTextBox(hover);
      const insideSelected =
        this.#copiesTextBoxes() && this.boundingBox.containsTranslationPoint(coords);
      if (overBox || insideSelected) return { type: "copy" };
    }

    if (coords && this.boundingBox.containsTranslationPoint(coords)) return { type: "move" };

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
          case "component":
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
            selection: {
              startPos: event.origin.scene,
              currentPos: event.coords.scene,
              initialSelection: [],
            },
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
    this.editor.hover.clear();
    this.setState({ type: "idle" });
  }

  override dispose(): void {
    this.upgradePreview.propsCell.dispose();
    super.dispose();
  }

  override drawScene(canvas: Canvas): void {
    void canvas;
  }

  override drawOverlay(canvas: Canvas): void {
    // The box shows at rest and while resizing (its handles are being dragged);
    // it hides while moving, turning, or bending, so the shape shows unobstructed.
    const resizing = this.state.type === "resizing";
    if (this.editor.sessionMode !== "preview" && (resizing || !this.isEditing(this.state))) {
      this.boundingBox.draw(canvas);
    }

    this.marquee.draw(canvas);
    this.upgradePreview.draw(canvas);

    const state = this.getState();
    if (state.type !== "translating" || state.translate.guides.length === 0) return;

    const ids = this.editor.selection.ids;
    const selection = this.editor.positionSelection(ids);
    // Boxes moving as a whole snap in scene units: draw their guides as they are.
    if (!selection) {
      this.#snapLines.draw(canvas, state.translate.guides);
      return;
    }
    const node = this.editor.selectionNode(ids);
    if (!node) return;

    const guides = state.translate.guides;
    const crossings = this.editor.snapping.crossings(selection.layer, [
      this.editor.selectionBounds(ids),
    ]);
    canvas.withTransform(this.editor.sceneTransform(node), () => {
      this.#snapLines.draw(canvas, guides, crossings);
    });
  }
}

/** Whether Shift-click adds this hovered object to the selection, matching the Selection behavior. */
function shiftClickAddable(object: ShiftObject | null): boolean {
  switch (object?.kind) {
    case "point":
    case "anchor":
    case "segment":
    case "component":
    case "node":
      return true;
    default:
      return false;
  }
}
