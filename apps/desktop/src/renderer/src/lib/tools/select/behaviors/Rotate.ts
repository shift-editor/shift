import { Vec2, type Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import type { Select } from "../Select";
import { pointInSelectedNodeSpace, selectedGeometryEdit } from "./selectedGeometryEdit";

export class Rotate implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #origin: Point2D | null = null;
  #nodePosition: Point2D | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const next = this.tryStartRotate(event, ctx.editor, ctx.tool);
    if (!next) return false;

    ctx.setState(next);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    if (state.type !== "rotating") return false;
    if (!this.#draft || !this.#origin || !this.#nodePosition) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.commit();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.discard();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "rotating" && next.type === "rotating") {
      // editor.setHandlesVisible(false);
      editor.hover.clear();
    }

    if (prev.type === "rotating" && next.type !== "rotating") {
      this.#cleanup();
      // editor.setHandlesVisible(true);
    }
  }

  #cleanup(): void {
    this.#draft = null;
    this.#origin = null;
    this.#nodePosition = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    if (!this.#nodePosition || !this.#origin) return state;

    const currentPos = Vec2.sub(event.coords.scene, this.#nodePosition);
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const deltaAngle = rawAngle - state.rotate.startAngle;
    const currentAngle = state.rotate.startAngle + deltaAngle;

    this.#draft!.previewRotate(deltaAngle, this.#origin);

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle,
      },
    };
  }

  private tryStartRotate(event: DragStartEvent, editor: Editor, tool: Select): SelectState | null {
    const hit = tool.boundingBox.hit(event.origin);
    if (hit?.type !== "rotate") return null;

    const edit = selectedGeometryEdit(editor);
    if (!edit) return null;

    const corner = hit.corner;
    const localPoint = pointInSelectedNodeSpace(event.origin.scene, edit);
    const center = pointInSelectedNodeSpace(hit.center, edit);
    const startAngle = Vec2.angleTo(center, localPoint);

    this.#draft = new GlyphLayerEditDraft(edit.layer, {
      points: edit.pointIds,
      anchors: edit.anchorIds,
    });
    this.#origin = center;
    this.#nodePosition = { ...edit.node.position };

    return {
      type: "rotating",
      rotate: {
        corner,
        startPos: localPoint,
        lastPos: localPoint,
        center,
        startAngle,
        currentAngle: startAngle,
      },
    };
  }
}
