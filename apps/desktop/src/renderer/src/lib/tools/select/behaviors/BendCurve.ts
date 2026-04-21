import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { GlyphDraft } from "@/types/draft";

export class BendCurve implements SelectHandlerBehavior {
  #draft: GlyphDraft | null = null;
  #hasChanges = false;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if ((state.type !== "ready" && state.type !== "selected") || !event.metaKey) return false;

    const hit = ctx.editor.hitTest(event.coords);
    if (!hit || hit.type !== "segment" || hit.segment.type !== "cubic") return false;

    const { t, closestPoint, segmentId, segment } = hit;
    const cubic = segment.asCubic();
    if (!cubic) return true;
    const { control1, control2 } = cubic.points;

    this.#draft = ctx.editor.createDraft();
    this.#hasChanges = false;

    ctx.setState({
      type: "bending",
      bend: {
        t,
        startPos: closestPoint,
        segmentId,
        initialControlOne: control1,
        initialControlTwo: control2,
      },
    });
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "bending") return false;
    if (!this.#draft) return false;

    const { glyphLocal } = event.coords;
    const delta = Vec2.sub(glyphLocal, state.bend.startPos);
    const t = state.bend.t;
    const w1 = 3 * (1 - t) ** 2 * t;
    const w2 = 3 * (1 - t) * t ** 2;
    const denom = w1 * w1 + w2 * w2;
    if (Math.abs(denom) < 1e-12) return true;

    const segment = ctx.editor.getSegmentById(state.bend.segmentId);
    if (!segment || segment.type !== "cubic") return true;

    const delta1 = Vec2.scale(delta, w1 / denom);
    const delta2 = Vec2.scale(delta, w2 / denom);
    const { initialControlOne, initialControlTwo } = state.bend;
    const newCp1 = Vec2.add(initialControlOne, delta1);
    const newCp2 = Vec2.add(initialControlTwo, delta2);
    const cubic = segment.asCubic();
    if (!cubic) return true;
    const { control1, control2 } = cubic.points;

    const updates = [
      { node: { kind: "point" as const, id: control1.id }, x: newCp1.x, y: newCp1.y },
      { node: { kind: "point" as const, id: control2.id }, x: newCp2.x, y: newCp2.y },
    ];
    this.#draft.setPositions(updates);
    this.#hasChanges = true;
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;

    if (this.#hasChanges) {
      this.#draft?.finish("Bend curve");
    } else {
      this.#draft?.discard();
    }
    this.#draft = null;
    this.#hasChanges = false;

    ctx.setState(ctx.editor.selection.hasSelection() ? { type: "selected" } : { type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;
    this.#draft?.discard();
    this.#draft = null;
    this.#hasChanges = false;
    ctx.setState(ctx.editor.selection.hasSelection() ? { type: "selected" } : { type: "ready" });
    return true;
  }
}
