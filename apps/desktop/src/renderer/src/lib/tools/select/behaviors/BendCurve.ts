import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";

export class BendCurve implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #hasChanges = false;

  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready" || !event.metaKey) return false;

    const instance = ctx.editor.glyphInstance;
    if (!instance?.layer) return false;

    const geometry = instance.geometry;
    const hit = geometry.hitSegment(event.coords.glyphLocal, ctx.editor.hitRadius);
    if (!hit) return false;

    const { t, closestPoint, segmentId } = hit;
    const segment = geometry.segment(segmentId);
    if (!segment) return false;

    const cubic = segment.asCubic();
    if (!cubic) return false;

    const { controlStart, controlEnd } = cubic;

    this.#draft = ctx.editor.beginGlyphLayerEditDraft({
      points: [controlStart.id, controlEnd.id],
    });
    this.#hasChanges = false;

    ctx.setState({
      type: "bending",
      bend: {
        t,
        startPos: closestPoint,
        segmentId,
        controlOneId: controlStart.id,
        controlTwoId: controlEnd.id,
        initialControlOne: controlStart,
        initialControlTwo: controlEnd,
      },
    });
    return true;
  }

  onDrag(state: SelectState, _ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "bending") return false;
    if (!this.#draft) return false;

    const { glyphLocal } = event.coords;
    const delta = Vec2.sub(glyphLocal, state.bend.startPos);
    const t = state.bend.t;
    const w1 = 3 * (1 - t) ** 2 * t;
    const w2 = 3 * (1 - t) * t ** 2;
    const denom = w1 * w1 + w2 * w2;
    if (Math.abs(denom) < 1e-12) return true;

    const delta1 = Vec2.scale(delta, w1 / denom);
    const delta2 = Vec2.scale(delta, w2 / denom);
    const { initialControlOne, initialControlTwo } = state.bend;
    const newCp1 = Vec2.add(initialControlOne, delta1);
    const newCp2 = Vec2.add(initialControlTwo, delta2);

    const updates = [
      {
        kind: "point" as const,
        id: state.bend.controlOneId,
        x: newCp1.x,
        y: newCp1.y,
      },
      {
        kind: "point" as const,
        id: state.bend.controlTwoId,
        x: newCp2.x,
        y: newCp2.y,
      },
    ];
    this.#draft.previewPositionPatch(updates);
    this.#hasChanges = true;
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;

    if (this.#hasChanges) {
      this.#draft?.commit();
    } else {
      this.#draft?.discard();
    }
    this.#draft = null;
    this.#hasChanges = false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;
    this.#draft?.discard();
    this.#draft = null;
    this.#hasChanges = false;
    ctx.setState({ type: "ready" });
    return true;
  }
}
