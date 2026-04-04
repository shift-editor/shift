import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { CornerHandle } from "@/types/boundingBox";
import type { RotateSnapSession } from "@/lib/editor/snapping/types";

export class RotateBehavior implements SelectHandlerBehavior {
  #snap: RotateSnapSession | null = null;

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

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "rotating") return false;
    state.rotate.session.commit();
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "rotating") return false;
    state.rotate.session.cancel();
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
      this.clearSnap();
      editor.setHandlesVisible(true);
    }
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: ToolEventOf<"drag">,
  ): SelectState & { type: "rotating" } {
    const currentPos = event.coords.glyphLocal;
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const rawDelta = rawAngle - state.rotate.startAngle;

    let deltaAngle = rawDelta;
    let snappedAngle: number | undefined;

    if (this.#snap) {
      const snapResult = this.#snap.snap(rawDelta, { shiftKey: event.shiftKey });
      deltaAngle = snapResult.delta;
      if (snapResult.source === "angle") snappedAngle = snapResult.delta;
    }

    const currentAngle = state.rotate.startAngle + deltaAngle;

    state.rotate.session.update(deltaAngle, currentPos, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey ?? false,
    });

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle,
        ...(snappedAngle !== undefined ? { snappedAngle } : {}),
      },
    };
  }

  private tryStartRotate(event: ToolEventOf<"dragStart">, editor: EditorAPI): SelectState | null {
    const point = editor.getPointAt(event.coords);
    if (point) return null;

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
    this.startSnap(editor);
    const session = editor.beginRotateDrag(
      {
        pointIds: editor.getSelectedPoints(),
        anchorIds: editor.getSelectedAnchors(),
      },
      center,
      localPoint,
      "Rotate Points",
    );

    return {
      type: "rotating",
      rotate: {
        session,
        corner,
        startPos: localPoint,
        lastPos: localPoint,
        center,
        startAngle,
        currentAngle: startAngle,
      },
    };
  }

  private startSnap(editor: EditorAPI): void {
    this.clearSnap();
    this.#snap = editor.createRotateSnapSession();
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}
