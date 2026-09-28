import { Vec2, type Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent, ModifierKeys } from "../../core/GestureDetector";
import type { BendDrag, SelectBehavior, SelectState } from "../types";
import type { GlyphLayerEdit } from "../../../model/GlyphLayerEdit";
import { objectIsKindOf } from "../../../../types/object";

export class BendCurve implements SelectBehavior {
  #edit: GlyphLayerEdit | null = null;
  #done: (() => void) | null = null;
  #hasChanges = false;

  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready" || !event.metaKey) return false;
    if (event.target.kind !== "segment") return false;

    const object = ctx.editor.object(event.target.id);
    if (!objectIsKindOf(object, "segment")) return false;

    const layer = object.layer;
    if (!layer || layer.sourceId !== ctx.editor.activeSourceId) return false;

    const segment = layer.segment(object.segmentId);
    const cubic = segment?.asCubic();
    if (!cubic) return false;

    const { start, controlStart, controlEnd, end } = cubic;

    const edit = layer.beginEdit();
    this.#edit = edit;
    this.#done = ctx.onCancel(() => edit.cancel());
    this.#hasChanges = false;

    ctx.setState({
      type: "bending",
      bend: {
        t: event.target.t,
        startPos: event.target.closestPoint,
        segmentId: object.segmentId,
        controlOneId: controlStart.id,
        controlTwoId: controlEnd.id,
        anchorStart: { x: start.x, y: start.y },
        anchorEnd: { x: end.x, y: end.y },
        initialControlOne: controlStart,
        initialControlTwo: controlEnd,
      },
    });
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "bending") return false;
    if (!this.#edit) return false;

    const object = ctx.editor.object(state.bend.segmentId);
    if (!objectIsKindOf(object, "segment")) return false;

    const pointer = ctx.editor.getPointInNodeSpace(event.coords.scene, object.node.position);
    const controls = bentControls(state.bend, pointer, event);
    if (!controls) return true;

    const [controlOne, controlTwo] = controls;
    this.#edit.setPositions([
      {
        kind: "point",
        id: state.bend.controlOneId,
        x: controlOne.x,
        y: controlOne.y,
      },
      {
        kind: "point",
        id: state.bend.controlTwoId,
        x: controlTwo.x,
        y: controlTwo.y,
      },
    ]);
    this.#hasChanges = true;
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;

    if (this.#hasChanges) {
      this.#edit?.finish("Bend curve");
      if (this.#done) this.#done();
    }
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;
    this.#cleanup();
    ctx.setState({ type: "ready" });
    return true;
  }

  #cleanup(): void {
    this.#edit = null;
    this.#done = null;
    this.#hasChanges = false;
  }
}

type BentControls = readonly [Point2D, Point2D];

/**
 * Solves the two control positions that pull the curve point at `bend.t` onto `pointer`.
 *
 * Shift snaps each handle to the multiple of 45° nearest its free-bend direction,
 * as RoboFont does; Alt keeps each handle's initial direction. Either way only handle lengths change, so the solve is a
 * least-squares fit of two scalars. Returns null when `t` sits on an endpoint and
 * the controls have no influence.
 */
function bentControls(
  bend: BendDrag,
  pointer: Point2D,
  modifiers: Pick<ModifierKeys, "shiftKey" | "altKey">,
): BentControls | null {
  const weights = bendWeights(bend.t);
  if (weights.denom < 1e-12) return null;

  const free = freeBend(bend, pointer);

  if (modifiers.shiftKey) {
    const directionOne = nearestFortyFive(Vec2.sub(free[0], bend.anchorStart));
    const directionTwo = nearestFortyFive(Vec2.sub(free[1], bend.anchorEnd));
    if (directionOne && directionTwo) {
      return bendAlongDirections(bend, pointer, directionOne, directionTwo);
    }
  }

  if (modifiers.altKey) {
    const directionOne = Vec2.unit(Vec2.sub(bend.initialControlOne, bend.anchorStart));
    const directionTwo = Vec2.unit(Vec2.sub(bend.initialControlTwo, bend.anchorEnd));
    const hasDirections = !Vec2.isZero(directionOne) && !Vec2.isZero(directionTwo);
    if (hasDirections) return bendAlongDirections(bend, pointer, directionOne, directionTwo);
  }

  return free;
}

/** Moves both controls with the pointer, weighted by their influence at `bend.t`. */
function freeBend(bend: BendDrag, pointer: Point2D): BentControls {
  const weights = bendWeights(bend.t);
  const delta = Vec2.sub(pointer, bend.startPos);
  return [
    Vec2.add(bend.initialControlOne, Vec2.scale(delta, weights.one / weights.denom)),
    Vec2.add(bend.initialControlTwo, Vec2.scale(delta, weights.two / weights.denom)),
  ];
}

const FORTY_FIVE_DEGREES = Math.PI / 4;

/** The unit direction at the multiple of 45° closest to `handle`, or null for a zero-length handle. */
function nearestFortyFive(handle: Point2D): Point2D | null {
  if (Vec2.isZero(handle)) return null;

  const angle =
    Math.round(Math.atan2(handle.y, handle.x) / FORTY_FIVE_DEGREES) * FORTY_FIVE_DEGREES;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function bendWeights(t: number): { one: number; two: number; denom: number } {
  const one = 3 * (1 - t) ** 2 * t;
  const two = 3 * (1 - t) * t ** 2;
  return { one, two, denom: one * one + two * two };
}

/**
 * Places each control on a fixed unit direction from its anchor, choosing the two
 * lengths that bring the curve point at `bend.t` closest to `pointer`. Parallel
 * directions leave one degree of freedom, which is split by curve weight.
 */
function bendAlongDirections(
  bend: BendDrag,
  pointer: Point2D,
  directionOne: Point2D,
  directionTwo: Point2D,
): BentControls {
  const { t, anchorStart, anchorEnd } = bend;
  const weights = bendWeights(t);
  const startWeight = (1 - t) ** 3 + weights.one;
  const endWeight = weights.two + t ** 3;
  const handlesAtAnchors = Vec2.add(
    Vec2.scale(anchorStart, startWeight),
    Vec2.scale(anchorEnd, endWeight),
  );
  const residual = Vec2.sub(pointer, handlesAtAnchors);

  const u = Vec2.scale(directionOne, weights.one);
  const v = Vec2.scale(directionTwo, weights.two);
  const uu = Vec2.dot(u, u);
  const uv = Vec2.dot(u, v);
  const vv = Vec2.dot(v, v);
  const det = uu * vv - uv * uv;

  let lengthOne: number;
  let lengthTwo: number;
  if (Math.abs(det) > 1e-9 * uu * vv) {
    const ur = Vec2.dot(u, residual);
    const vr = Vec2.dot(v, residual);
    lengthOne = (vv * ur - uv * vr) / det;
    lengthTwo = (uu * vr - uv * ur) / det;
  } else {
    const along = Vec2.dot(residual, directionOne);
    const orientation = Math.sign(Vec2.dot(directionOne, directionTwo)) || 1;
    lengthOne = (along * weights.one) / weights.denom;
    lengthTwo = (orientation * along * weights.two) / weights.denom;
  }

  return [
    Vec2.add(anchorStart, Vec2.scale(directionOne, lengthOne)),
    Vec2.add(anchorEnd, Vec2.scale(directionTwo, lengthTwo)),
  ];
}
