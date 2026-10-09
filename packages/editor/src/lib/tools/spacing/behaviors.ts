import { Rect } from "@shift/geo";
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
import type { Editor } from "../../editor/Editor";
import type { ScreenPoint } from "../../../types/coordinates";
import type { SpacingHalf } from "./RunSpacing";
import { SnapTargets } from "./SnapTargets";
import { spacingLabelRect } from "./SpacingLabel";
import type { SpacingTool } from "./Spacing";
import type { SpacingState } from "./types";

type SpacingContext = ToolContext<SpacingState, SpacingTool>;

/** How close, in screen pixels, a dragged sidebearing must come to a target to snap to it. */
const SNAP_DISTANCE_PX = 6;

/** Tracks the half under the pointer and whether the pointer is over its value pill. */
export const SpacingHover = createBehavior<SpacingState, SpacingTool>({
  onPointerMove(state: SpacingState, ctx: SpacingContext, event: PointerMoveEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.halfAt(event.coords.scene);
    const overLabel = hit !== null && onPill(ctx.editor, hit, event.coords.screen);
    const sameHalf = hit ? hit.equals(state.hit) : state.hit === null;
    if (!sameHalf || overLabel !== Boolean(state.overLabel) || state.quiet) {
      ctx.setState({ type: "ready", hit, selected: state.selected, overLabel });
    }
    return true;
  },
});

/** Clicking the hovered half's pill opens its value for typing. */
export const SpacingLabelClick = createBehavior<SpacingState, SpacingTool>({
  onClick(state: SpacingState, ctx: SpacingContext, event: ClickEvent): boolean {
    if (state.type !== "ready" || !state.hit) return false;
    if (!onPill(ctx.editor, state.hit, event.coords.screen)) return false;

    ctx.setState({ type: "editing", hit: state.hit });
    return true;
  },
});

/** Any canvas click or drag other than on the open pill closes the open value. */
export const SpacingEditingClose = createBehavior<SpacingState, SpacingTool>({
  onClick(state: SpacingState, ctx: SpacingContext, event: ClickEvent): boolean {
    if (state.type !== "editing") return false;
    if (onPill(ctx.editor, state.hit, event.coords.screen)) return true;

    const hit = ctx.tool.runs.halfAt(event.coords.scene);
    ctx.setState({ type: "ready", hit, selected: hit?.select(ctx.editor) ?? null });
    return true;
  },

  onDragStart(state: SpacingState, ctx: SpacingContext, event: DragStartEvent): boolean {
    if (state.type !== "editing") return false;
    const hit = ctx.tool.runs.halfAt(event.origin.scene);
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
export const SpacingSelectClick = createBehavior<SpacingState, SpacingTool>({
  onClick(state: SpacingState, ctx: SpacingContext, event: ClickEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.halfAt(event.coords.scene);
    ctx.setState({ ...state, hit, selected: hit?.select(ctx.editor) ?? null });
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
export const SpacingNudge = createBehavior<SpacingState, SpacingTool>({
  onKeyDown(state: SpacingState, ctx: SpacingContext, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;
    const runs = ctx.tool.runs;

    if (event.key === "Escape") {
      if (!state.selected) return false;
      ctx.setState({ ...state, selected: null });
      return true;
    }

    if (event.key === "Tab") {
      const from = state.selected ?? state.hit;
      const next = from ? runs.adjacent(from, event.shiftKey ? -1 : 1) : null;
      if (!next) return false;
      ctx.editor.history.captureOrJoin("Select spacing", () => next.select(ctx.editor));
      ctx.setState({ ...state, selected: next, quiet: false });
      return true;
    }

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
    const target = state.selected ?? state.hit;
    const half = target ? runs.refresh(target) : null;
    const glyphSide = half?.glyphSide;
    if (!half || !glyphSide) return false;

    const step = NUDGES_VALUES[nudgeMagnitude({ accel: event.accelKey, shift: event.shiftKey })];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    half.set(ctx.editor, glyphSide.sidebearing + direction * step);

    ctx.setState({
      type: "ready",
      hit: state.hit ? runs.refresh(state.hit) : null,
      selected: state.selected ? runs.refresh(half) : null,
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
export class SpacingDrag implements Behavior<SpacingState, SpacingTool> {
  #edit: SidebearingEdit | null = null;
  #done: (() => void) | null = null;
  #start = 0;
  #targets: SnapTargets | null = null;

  onDragStart(state: SpacingState, ctx: SpacingContext, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.halfAt(event.origin.scene);
    const glyphSide = hit?.glyphSide;
    const layer = hit?.layer(ctx.editor);
    if (!hit || !glyphSide || !layer) return false;

    this.#start = glyphSide.sidebearing;
    this.#targets = SnapTargets.for(hit, layer);
    const edit = layer.beginSidebearingEdit(hit.sidebearing);
    this.#edit = edit;
    this.#done = ctx.onCancel(() => edit.discard());
    ctx.setState({ type: "dragging", hit, origin: event.origin.scene, snap: null });
    return true;
  }

  onDrag(state: SpacingState, ctx: SpacingContext, event: DragEvent): boolean {
    if (state.type !== "dragging" || !this.#edit) return false;
    const editor = ctx.editor;
    const node = state.hit.gap.node;
    const sceneDelta = vectorBetween(
      scenePoint(state.origin.x, state.origin.y),
      event.coords.scene,
    );
    const dragged = this.#start + editor.toLocalVector(node, sceneDelta).x;
    const reach = editor.toLocalVector(node, sceneVector(SNAP_DISTANCE_PX / editor.zoom, 0)).x;
    const snapped = event.accelKey
      ? null
      : (this.#targets?.nearest(dragged, Math.abs(reach)) ?? null);
    const value = snapped ? snapped.sidebearing : dragged;
    this.#edit.preview(Math.round(value) - Math.round(this.#start));

    const hit = ctx.tool.runs.refresh(state.hit);
    if (!hit) {
      // The gap stopped existing mid-drag; drop it rather than edit a stale half.
      this.#edit.discard();
      if (this.#done) this.#done();
      this.#cleanup();
      ctx.setState({ type: "ready", hit: null, selected: null });
      return true;
    }
    ctx.setState({ ...state, hit, snap: snapped?.kind ?? null });
    return true;
  }

  onDragEnd(state: SpacingState, ctx: SpacingContext): boolean {
    if (state.type !== "dragging") return false;
    this.#edit?.commit("Change sidebearing");
    if (this.#done) this.#done();
    this.#cleanup();
    ctx.setState({ type: "ready", hit: state.hit, selected: state.hit });
    return true;
  }

  onDragCancel(state: SpacingState, ctx: SpacingContext): boolean {
    if (state.type !== "dragging") return false;
    this.#cleanup();
    ctx.setState({ type: "ready", hit: null, selected: null });
    return true;
  }

  #cleanup(): void {
    this.#edit = null;
    this.#done = null;
    this.#targets = null;
  }
}

/** Whether a screen point is on a half's value pill. */
function onPill(editor: Editor, half: SpacingHalf, point: ScreenPoint): boolean {
  const rect = spacingLabelRect(editor, half);
  return rect !== null && Rect.containsPoint(rect, point);
}
