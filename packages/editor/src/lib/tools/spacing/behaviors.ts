import { createBehavior, type Behavior, type ToolContext } from "../core/Behavior";
import type {
  ClickEvent,
  DragEvent,
  DragStartEvent,
  KeyDownEvent,
  PointerMoveEvent,
} from "../core/GestureDetector";
import { NUDGES_VALUES, nudgeMagnitude } from "../../../types/nudge";
import type { SidebearingEdit } from "../../model/SidebearingEdit";
import { sceneVector, scenePoint, vectorBetween } from "../../editor/spaces";
import { Rect } from "@shift/geo";
import { spacingLabelRect } from "./SpacingLabel";
import type { Editor } from "../../editor/Editor";
import type { ScenePoint } from "../../../types/coordinates";
import { sidebearingOfHalf, type SpacingGap, type SpacingSideName } from "../../../types/spacing";
import type { SpacingHit, SpacingSnap, SpacingState } from "./types";

/** How close, in screen pixels, a dragged sidebearing must come to a target to snap to it. */
const SNAP_DISTANCE_PX = 6;

interface SnapTarget {
  readonly kind: SpacingSnap;
  readonly sidebearing: number;
}

/** Tracks the gap under the pointer, which half of it, and whether its value pill. */
export const SpacingHover = createBehavior<SpacingState>({
  onPointerMove(
    state: SpacingState,
    ctx: ToolContext<SpacingState>,
    event: PointerMoveEvent,
  ): boolean {
    if (state.type !== "ready") return false;
    const hit = spacingHitAt(ctx.editor, event.coords.scene);
    const rect = hit ? spacingLabelRect(ctx.editor, hit.gap, hit.side) : null;
    const overLabel = rect !== null && Rect.containsPoint(rect, event.coords.screen);
    if (!sameHit(hit, state.hit) || overLabel !== Boolean(state.overLabel) || state.quiet) {
      ctx.setState({ type: "ready", hit, selected: state.selected, overLabel });
    }
    return true;
  },
});

/** Clicking the active half's pill opens its value for typing. */
export const SpacingLabelClick = createBehavior<SpacingState>({
  onClick(state: SpacingState, ctx: ToolContext<SpacingState>, event: ClickEvent): boolean {
    if (state.type !== "ready" || !state.hit) return false;
    const rect = spacingLabelRect(ctx.editor, state.hit.gap, state.hit.side);
    if (!rect || !Rect.containsPoint(rect, event.coords.screen)) return false;

    ctx.setState({ type: "editing", hit: state.hit });
    return true;
  },
});

/** Any canvas click or drag other than on the open pill closes the open value. */
export const SpacingEditingClose = createBehavior<SpacingState>({
  onClick(state: SpacingState, ctx: ToolContext<SpacingState>, event: ClickEvent): boolean {
    if (state.type !== "editing") return false;
    const rect = spacingLabelRect(ctx.editor, state.hit.gap, state.hit.side);
    if (rect && Rect.containsPoint(rect, event.coords.screen)) return true;

    const hit = spacingHitAt(ctx.editor, event.coords.scene);
    ctx.setState({ type: "ready", hit, selected: selectHalf(ctx.editor, hit) });
    return true;
  },

  onDragStart(state: SpacingState, ctx: ToolContext<SpacingState>, event: DragStartEvent): boolean {
    if (state.type !== "editing") return false;
    const hit = spacingHitAt(ctx.editor, event.origin.scene);
    ctx.setState({ type: "ready", hit, selected: state.hit });
    return true;
  },
});

/**
 * Clicking in a gap, away from its pill, selects the half under the pointer;
 * clicking off every gap clears the selection.
 *
 * @remarks
 * The selected half's glyph becomes the run's current glyph, so the glyph
 * sidebar shows it and Select edits it next.
 */
export const SpacingSelectClick = createBehavior<SpacingState>({
  onClick(state: SpacingState, ctx: ToolContext<SpacingState>, event: ClickEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = spacingHitAt(ctx.editor, event.coords.scene);
    ctx.setState({ ...state, hit, selected: selectHalf(ctx.editor, hit) });
    return true;
  },
});

/**
 * Arrow keys change the selected half, or the hovered one when none is
 * selected, and hide the overlays until the pointer moves, so the spacing
 * shows unobstructed. Tab and Shift-Tab select the next and previous half in
 * reading order. Escape clears the selection.
 *
 * @remarks
 * Right adds space, left removes it, by the nudge step: 1, Shift 10, or the
 * accelerator 100. Each press is one undo step.
 */
export const SpacingNudge = createBehavior<SpacingState>({
  onKeyDown(state: SpacingState, ctx: ToolContext<SpacingState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;
    if (event.key === "Escape") {
      if (!state.selected) return false;
      ctx.setState({ ...state, selected: null });
      return true;
    }
    if (event.key === "Tab") {
      const from = state.selected ?? state.hit;
      const next = from ? adjacentHalf(ctx.editor, from, event.shiftKey ? -1 : 1) : null;
      if (!next) return false;
      ctx.editor.history.captureOrJoin("Select spacing", () => selectHalf(ctx.editor, next));
      ctx.setState({ ...state, selected: next, quiet: false });
      return true;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;

    const target = state.selected ?? state.hit;
    const half = target ? followedHit(ctx.editor, target) : null;
    const current = half?.gap[half.side];
    if (!half || !current) return false;

    const step = NUDGES_VALUES[nudgeMagnitude({ accel: event.accelKey, shift: event.shiftKey })];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setSidebearing(ctx.editor, half, current.sidebearing + direction * step);

    const moved = followedHit(ctx.editor, half);
    ctx.setState({
      type: "ready",
      hit: state.hit ? followedHit(ctx.editor, state.hit) : null,
      selected: state.selected ? moved : null,
      quiet: true,
    });
    return true;
  },
});

/**
 * Dragging anywhere in a gap changes the half under the pointer at the press.
 *
 * @remarks
 * Moving right adds space on either side: on the left half the advance
 * boundary follows the pointer, on the right half the right glyph does. The
 * change is in whole units at the active source and commits as one undo step.
 * Within a few pixels of the gap's other half or the glyph's other
 * sidebearing the value snaps to it; holding the accelerator turns that off.
 */
export class SpacingDrag implements Behavior<SpacingState> {
  #edit: SidebearingEdit | null = null;
  #done: (() => void) | null = null;
  #start = 0;
  #targets: readonly SnapTarget[] = [];

  onDragStart(state: SpacingState, ctx: ToolContext<SpacingState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;
    const editor = ctx.editor;
    const hit = spacingHitAt(editor, event.origin.scene);
    const sourceId = editor.activeSourceId;
    const side = hit?.gap[hit.side];
    if (!hit) return false;
    if (!side || !sourceId || editor.sessionMode !== "workspace") return false;

    const layer = editor.glyphForId(side.glyphId)?.layerForSource(sourceId);
    if (!layer) return false;

    const sidebearing = sidebearingOfHalf(hit.side);
    const own = layer.sidebearings;
    const otherHalf = hit.gap[hit.side === "left" ? "right" : "left"]?.sidebearing;
    const otherSidebearing = sidebearing === "rsb" ? own.lsb : own.rsb;
    this.#start = side.sidebearing;
    this.#targets = [
      ...(otherHalf === undefined ? [] : [{ kind: "otherHalf" as const, sidebearing: otherHalf }]),
      ...(otherSidebearing === null
        ? []
        : [{ kind: "otherSidebearing" as const, sidebearing: otherSidebearing }]),
    ];

    const edit = layer.beginSidebearingEdit(sidebearing);
    this.#edit = edit;
    this.#done = ctx.onCancel(() => edit.discard());
    ctx.setState({ type: "dragging", hit, origin: event.origin.scene, snap: null });
    return true;
  }

  onDrag(state: SpacingState, ctx: ToolContext<SpacingState>, event: DragEvent): boolean {
    if (state.type !== "dragging" || !this.#edit) return false;
    const editor = ctx.editor;
    const { origin } = state;
    const sceneDelta = vectorBetween(scenePoint(origin.x, origin.y), event.coords.scene);
    const node = state.hit.gap.node;
    const raw = this.#start + editor.toLocalVector(node, sceneDelta).x;
    const reach = editor.toLocalVector(node, sceneVector(SNAP_DISTANCE_PX / editor.zoom, 0)).x;
    const snapped = event.accelKey ? null : nearestTarget(this.#targets, raw, Math.abs(reach));
    const value = snapped ? snapped.sidebearing : raw;
    this.#edit.preview(Math.round(value) - Math.round(this.#start));

    ctx.setState({ ...state, hit: followedHit(editor, state.hit), snap: snapped?.kind ?? null });
    return true;
  }

  onDragEnd(state: SpacingState, ctx: ToolContext<SpacingState>): boolean {
    if (state.type !== "dragging") return false;
    this.#edit?.commit("Change sidebearing");
    if (this.#done) this.#done();
    this.#cleanup();
    ctx.setState({ type: "ready", hit: state.hit, selected: state.hit });
    return true;
  }

  onDragCancel(state: SpacingState, ctx: ToolContext<SpacingState>): boolean {
    if (state.type !== "dragging") return false;
    this.#cleanup();
    ctx.setState({ type: "ready", hit: null, selected: null });
    return true;
  }

  #cleanup(): void {
    this.#edit = null;
    this.#done = null;
    this.#targets = [];
  }
}

/** The target nearest `value` within `reach` units, if any. */
function nearestTarget(
  targets: readonly SnapTarget[],
  value: number,
  reach: number,
): SnapTarget | null {
  let nearest: SnapTarget | null = null;
  for (const target of targets) {
    const distance = Math.abs(target.sidebearing - value);
    if (distance > reach) continue;
    if (!nearest || distance < Math.abs(nearest.sidebearing - value)) nearest = target;
  }
  return nearest;
}

/**
 * Sets a half's sidebearing at the active source, as one undo step.
 *
 * @param value - The new sidebearing in units; rounded, and ignored when unchanged.
 * @returns false when nothing changed or the glyph has no layer there.
 */
export function setSidebearing(editor: Editor, hit: SpacingHit, value: number): boolean {
  const half = hit.gap[hit.side];
  const sourceId = editor.activeSourceId;
  if (!half || !sourceId || editor.sessionMode !== "workspace") return false;

  const layer = editor.glyphForId(half.glyphId)?.layerForSource(sourceId);
  const rounded = Math.round(value);
  if (!layer || rounded === Math.round(half.sidebearing)) return false;

  if (sidebearingOfHalf(hit.side) === "rsb") layer.setRightSidebearing(rounded);
  else layer.setLeftSidebearing(rounded);
  return true;
}

/** Makes a half's glyph the run's current glyph, so the sidebar shows it; returns the half. */
function selectHalf(editor: Editor, hit: SpacingHit | null): SpacingHit | null {
  const itemId = hit?.gap[hit.side]?.itemId;
  if (hit && itemId) editor.nodeDefinition("textRun").editItem(hit.gap.node, itemId);
  return hit;
}

/**
 * The half before or after `from` in reading order: a gap's left half, then
 * its right half, then the next gap's.
 *
 * @returns null at either end of the run.
 */
function adjacentHalf(editor: Editor, from: SpacingHit, step: -1 | 1): SpacingHit | null {
  const halves = editor
    .nodeDefinition("textRun")
    .spacingGaps(from.gap.node)
    .flatMap((gap) =>
      (["left", "right"] as const).filter((side) => gap[side]).map((side) => ({ gap, side })),
    );
  const index = halves.findIndex(
    (half) =>
      half.side === from.side &&
      half.gap.left?.itemId === from.gap.left?.itemId &&
      half.gap.right?.itemId === from.gap.right?.itemId,
  );
  return index === -1 ? null : (halves[index + step] ?? null);
}

/** A gap re-measured by its two glyphs after an edit, keeping its side. */
export function followedHit(editor: Editor, dragged: SpacingHit): SpacingHit {
  const { node, left, right } = dragged.gap;
  const gap = editor
    .nodeDefinition("textRun")
    .spacingGapBetween(node, left?.itemId ?? null, right?.itemId ?? null);
  return gap ? { gap, side: dragged.side } : dragged;
}

/**
 * The gap under a scene point in the topmost run that has one, and its half.
 *
 * @remarks
 * Each half spans its outline edge and the boundary, in either order, so a
 * negative sidebearing's half lies past the boundary. The half containing the
 * point wins; where both do, the negative one; where neither does, left of the
 * boundary is the left half.
 * A gap with only one side always reports that side.
 */
function spacingHitAt(editor: Editor, point: ScenePoint): SpacingHit | null {
  const definition = editor.nodeDefinition("textRun");
  const runs = editor.scene.nodesOfKind("textRun");
  for (let index = runs.length - 1; index >= 0; index--) {
    const node = runs[index]!;
    const local = editor.toLocal(node, point);
    const gap = definition.spacingGapAt(node, local);
    if (!gap) continue;

    return { gap, side: halfAt(gap, local.x) };
  }
  return null;
}

function halfAt(gap: SpacingGap, x: number): SpacingSideName {
  const inLeft = gap.left !== null && between(x, gap.left.edge, gap.boundary);
  const inRight = gap.right !== null && between(x, gap.boundary, gap.right.edge);
  if (inLeft !== inRight) return inLeft ? "left" : "right";
  // Overlapping halves: the negative one is only reachable here.
  if (inLeft && gap.left!.sidebearing < 0) return "left";
  if (inRight && gap.right!.sidebearing < 0) return "right";

  const pointerSide = x < gap.boundary ? "left" : "right";
  return gap[pointerSide] ? pointerSide : onlySide(gap);
}

function between(x: number, a: number, b: number): boolean {
  return x >= Math.min(a, b) && x <= Math.max(a, b);
}

/** The side a one-sided gap has, at a line end or beside a glyph without an outline. */
function onlySide(gap: SpacingGap): SpacingSideName {
  return gap.left ? "left" : "right";
}

function sameHit(a: SpacingHit | null, b: SpacingHit | null): boolean {
  if (!a || !b) return a === b;
  return a.side === b.side && sameGap(a.gap, b.gap);
}

function sameGap(a: SpacingGap, b: SpacingGap): boolean {
  return (
    a.node.id === b.node.id &&
    a.boundary === b.boundary &&
    a.left?.itemId === b.left?.itemId &&
    a.right?.itemId === b.right?.itemId &&
    a.left?.sidebearing === b.left?.sidebearing &&
    a.right?.sidebearing === b.right?.sidebearing
  );
}
