import { Vec2 } from "@shift/geo";
import { Glyphs } from "@shift/font";
import type { GlyphSnapshot, Point2D } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { CornerHandle } from "@/types/boundingBox";
import type { RotateSnapSession } from "@/lib/editor/snapping/types";
import type { GlyphDraft } from "@/types/draft";

import type { NodePositionUpdateList } from "@/types/positionUpdate";
import type { DragTarget } from "../../core/EditorAPI";

export class RotateBehavior implements SelectHandlerBehavior {
  #snap: RotateSnapSession | null = null;
  #draft: GlyphDraft | null = null;
  #target: DragTarget | null = null;
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
    if (!this.#draft || !this.#target || !this.#origin) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "rotating") return false;
    this.#draft?.finish("Rotate Points");
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

  #cleanup(editor: EditorAPI): void {
    this.#draft = null;
    this.#target = null;
    this.#origin = null;
    this.clearSnap();
    editor.setSnapIndicator(null);
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

    const updates = buildRotateUpdates(this.#draft!.base, this.#target!, this.#origin!, deltaAngle);
    this.#draft!.setPositions(updates);

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

    this.#draft = editor.createDraft();
    this.#target = {
      pointIds: [...editor.selection.pointIds],
      anchorIds: [...editor.selection.anchorIds],
    };
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

  private startSnap(editor: EditorAPI): void {
    this.clearSnap();
    this.#snap = editor.createRotateSnapSession();
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}

function buildRotateUpdates(
  base: GlyphSnapshot,
  target: DragTarget,
  origin: Point2D,
  angle: number,
): NodePositionUpdateList {
  const updates: Array<NodePositionUpdateList[number]> = [];

  for (const point of Glyphs.findPoints(base, target.pointIds)) {
    const next = Vec2.rotateAround(point, origin, angle);
    updates.push({
      node: { kind: "point", id: point.id },
      x: next.x,
      y: next.y,
    });
  }

  for (const anchorId of target.anchorIds) {
    const anchor = base.anchors.find((item) => item.id === anchorId);
    if (!anchor) continue;
    const next = Vec2.rotateAround(anchor, origin, angle);
    updates.push({
      node: { kind: "anchor", id: anchorId },
      x: next.x,
      y: next.y,
    });
  }

  return updates;
}
