import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import { objectIsKindOf } from "@/types";

export class BendCurve implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #hasChanges = false;

  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready" || !event.metaKey) return false;
    if (event.target.kind !== "segment") return false;

    const object = ctx.editor.object(event.target.id);
    if (!objectIsKindOf(object, "segment")) return false;

    const segment = object.layer.segment(object.segmentId);
    const cubic = segment?.asCubic();
    if (!cubic) return false;

    const { controlStart, controlEnd } = cubic;

    this.#draft = new GlyphLayerEditDraft(object.layer, {
      points: [controlStart.id, controlEnd.id],
    });
    this.#hasChanges = false;

    ctx.setState({
      type: "bending",
      bend: {
        t: event.target.t,
        startPos: event.target.closestPoint,
        segmentId: object.segmentId,
        controlOneId: controlStart.id,
        controlTwoId: controlEnd.id,
        initialControlOne: controlStart,
        initialControlTwo: controlEnd,
      },
    });
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "bending") return false;
    if (!this.#draft) return false;

    const object = ctx.editor.object(state.bend.segmentId);
    if (!objectIsKindOf(object, "segment")) return false;

    const point = ctx.editor.getPointInNodeSpace(event.coords.scene, object.node.position);
    const delta = Vec2.sub(point, state.bend.startPos);
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

    this.#draft.previewPositionPatch([
      {
        kind: "point",
        id: state.bend.controlOneId,
        x: newCp1.x,
        y: newCp1.y,
      },
      {
        kind: "point",
        id: state.bend.controlTwoId,
        x: newCp2.x,
        y: newCp2.y,
      },
    ]);
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
