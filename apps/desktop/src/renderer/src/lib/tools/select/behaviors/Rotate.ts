import { Vec2, type Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { CornerHandle } from "@/types/boundingBox";
import type { SourceEditDraft } from "@/lib/editor/SourceEditDraft";

export class Rotate implements SelectBehavior {
  #draft: SourceEditDraft | null = null;
  #origin: Point2D | null = null;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "selected") return false;

    const next = this.tryStartRotate(event, ctx.editor);
    if (!next) return false;

    ctx.setState(next);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "rotating") return false;
    if (!this.#draft || !this.#origin) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "rotating") return false;
    this.#draft?.commit("Rotate Points");
    this.#cleanup(ctx.editor);
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "rotating") return false;
    this.#draft?.discard();
    this.#cleanup(ctx.editor);
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "rotating" && next.type === "rotating") {
      editor.setHandlesVisible(false);
      editor.clearHover();
    }
    if (prev.type === "rotating" && next.type !== "rotating") {
      this.#cleanup(editor);
      editor.setHandlesVisible(true);
    }
  }

  #cleanup(editor: Editor): void {
    this.#draft = null;
    this.#origin = null;
    editor.requestRedraw();
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: ToolEventOf<"drag">,
  ): SelectState & { type: "rotating" } {
    const currentPos = event.coords.glyphLocal;
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const deltaAngle = rawAngle - state.rotate.startAngle;

    const currentAngle = state.rotate.startAngle + deltaAngle;

    this.#draft!.previewRotate(deltaAngle, this.#origin!);

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle,
      },
    };
  }

  private tryStartRotate(event: ToolEventOf<"dragStart">, editor: Editor): SelectState | null {
    const hit = editor.hitTest(event.coords);
    if (hit?.type === "point") return null;

    const bbHit = editor.hitTestBoundingBoxAt(event.coords);
    const corner: CornerHandle | null = bbHit?.type === "rotate" ? bbHit.corner : null;
    const bounds = editor.getSelectionBoundingRect();

    if (!corner || !bounds) return null;

    const localPoint = event.coords.glyphLocal;

    const center = Vec2.midpoint(
      Vec2.fromArray([bounds.left, bounds.top]),
      Vec2.fromArray([bounds.right, bounds.bottom]),
    );

    const startAngle = Vec2.angleTo(center, localPoint);

    this.#draft = editor.beginSourceEditDraft({
      points: [...editor.selection.pointIds],
      anchors: [...editor.selection.anchorIds],
    });
    this.#origin = center;

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
