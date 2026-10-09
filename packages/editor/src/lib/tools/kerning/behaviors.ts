import { createBehavior, type Behavior, type ToolContext } from "../core/Behavior";
import type {
  ClickEvent,
  DragEndEvent,
  DragEvent,
  DragStartEvent,
  KeyDownEvent,
  PointerMoveEvent,
} from "../core/GestureDetector";
import { NUDGES_VALUES, nudgeMagnitude } from "../../../types/nudge";
import { scenePoint, vectorBetween } from "../../editor/spaces";
import type { ScenePoint } from "../../../types/coordinates";
import { onKerningLabel } from "./KerningLabel";
import type { KerningTool } from "./Kerning";
import type { KerningState } from "./types";
import { kerningValueEdit } from "../../model/Kerning";
import type { KerningEdit } from "../../model/KerningEdit";

type KerningContext = ToolContext<KerningState, KerningTool>;

/** Tracks the pair under the pointer and the part of its pill the pointer is over. */
export const KerningHover = createBehavior<KerningState, KerningTool>({
  onPointerMove(state: KerningState, ctx: KerningContext, event: PointerMoveEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.pairAt(event.coords.scene);
    const overLabel = hit !== null && onKerningLabel(ctx.editor, hit, event.coords.screen);
    const samePair = hit ? hit.equals(state.hit) : state.hit === null;
    if (!samePair || overLabel !== Boolean(state.overLabel) || state.quiet) {
      ctx.setState({ type: "ready", hit, selected: state.selected, overLabel });
    }
    return true;
  },
});

/** Clicking the hovered pair's pill opens its value for typing at the active source. */
export const KerningLabelClick = createBehavior<KerningState, KerningTool>({
  onClick(state: KerningState, ctx: KerningContext, event: ClickEvent): boolean {
    if (state.type !== "ready" || !state.hit) return false;
    if (!onKerningLabel(ctx.editor, state.hit, event.coords.screen)) return false;

    if (state.hit.source(ctx.editor)) ctx.setState({ type: "editing", hit: state.hit });
    return true;
  },
});

/** Any canvas click or drag other than on the open pill closes the open value. */
export const KerningEditingClose = createBehavior<KerningState, KerningTool>({
  onClick(state: KerningState, ctx: KerningContext, event: ClickEvent): boolean {
    if (state.type !== "editing") return false;
    if (onKerningLabel(ctx.editor, state.hit, event.coords.screen)) return true;

    const hit = ctx.tool.runs.pairAt(event.coords.scene);
    ctx.setState({ type: "ready", hit, selected: hit });
    return true;
  },

  onDragStart(state: KerningState, ctx: KerningContext, event: DragStartEvent): boolean {
    if (state.type !== "editing") return false;
    const hit = ctx.tool.runs.pairAt(event.origin.scene);
    ctx.setState({ type: "ready", hit, selected: state.hit });
    return true;
  },
});

/** Clicking a pair away from its pill selects it for the arrow keys; clicking off every pair clears it. */
export const KerningSelectClick = createBehavior<KerningState, KerningTool>({
  onClick(state: KerningState, ctx: KerningContext, event: ClickEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.pairAt(event.coords.scene);
    ctx.setState({ ...state, hit, selected: hit });
    return true;
  },
});

/**
 * Arrow keys change the selected pair, or the hovered one when none is
 * selected, and hide the overlays until the pointer moves. Tab and
 * Shift-Tab select the next and previous pair; Escape clears the selection.
 *
 * @remarks
 * Right opens the pair up, left tightens it, by the nudge step: 1, Shift 10,
 * or the accelerator 100. Each press is one undo step at the active source.
 */
export const KerningNudge = createBehavior<KerningState, KerningTool>({
  onKeyDown(state: KerningState, ctx: KerningContext, event: KeyDownEvent): boolean {
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
      ctx.setState({ ...state, selected: next, quiet: false });
      return true;
    }

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
    const target = state.selected ?? state.hit;
    const pair = target ? runs.refresh(target) : null;
    const edited = pair?.editablePair(ctx.editor);
    if (!pair || !edited) return false;

    const step = NUDGES_VALUES[nudgeMagnitude({ accel: event.accelKey, shift: event.shiftKey })];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    pair.set(ctx.editor, edited.amount + direction * step);

    ctx.setState({
      type: "ready",
      hit: state.hit ? runs.refresh(state.hit) : null,
      selected: state.selected ? runs.refresh(pair) : null,
      quiet: true,
    });
    return true;
  },
});

/**
 * Dragging a pair changes its kern: right opens it up, left tightens it.
 *
 * @remarks
 * The change previews without committing, in whole units at the active
 * source, and commits as one undo step on release.
 */
export class KerningDrag implements Behavior<KerningState, KerningTool> {
  #edit: KerningEdit | null = null;
  #done: (() => void) | null = null;

  onDragStart(state: KerningState, ctx: KerningContext, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;
    const hit = ctx.tool.runs.pairAt(event.origin.scene);
    const edited = hit?.editablePair(ctx.editor);
    if (!hit || !edited) return false;

    const edit = ctx.editor.font.beginKerningEdit();
    this.#edit = edit;
    this.#done = ctx.onCancel(() => edit.discard());
    ctx.setState({ type: "dragging", hit, origin: event.origin.scene, start: edited.amount });
    return true;
  }

  onDrag(state: KerningState, ctx: KerningContext, event: DragEvent): boolean {
    if (state.type !== "dragging" || !this.#edit) return false;
    const hit = ctx.tool.runs.refresh(state.hit);
    if (!hit) {
      // The pair stopped being neighbours mid-drag; drop it rather than kern a stale gap.
      this.#edit.discard();
      this.#finish();
      ctx.setState({ type: "ready", hit: null, selected: null });
      return true;
    }
    this.#preview(ctx, { ...state, hit }, event.coords.scene);
    ctx.setState({ ...state, hit });
    return true;
  }

  onDragEnd(state: KerningState, ctx: KerningContext, event: DragEndEvent): boolean {
    if (state.type !== "dragging" || !this.#edit) return false;
    this.#preview(ctx, state, event.coords.scene);
    this.#edit.commit("Change kerning");
    this.#finish();
    const hit = ctx.tool.runs.refresh(state.hit);
    ctx.setState({ type: "ready", hit, selected: hit });
    return true;
  }

  onDragCancel(state: KerningState, ctx: KerningContext): boolean {
    if (state.type !== "dragging") return false;
    this.#edit?.discard();
    this.#finish();
    ctx.setState({ type: "ready", hit: null, selected: null });
    return true;
  }

  /**
   * Previews the dragged kern against the value the drag started from: the
   * edit is measured from the committed pair, so a value equal to it
   * previews nothing.
   */
  #preview(
    ctx: KerningContext,
    state: Extract<KerningState, { type: "dragging" }>,
    point: ScenePoint,
  ): void {
    const pair = state.hit.editablePair(ctx.editor);
    const sourceId = state.hit.source(ctx.editor);
    if (!pair || !sourceId || !this.#edit) return;
    const amount = Math.round(draggedAmount(state, ctx, point));
    this.#edit.preview(amount === state.start ? [] : [kerningValueEdit(sourceId, pair, amount)]);
  }

  #finish(): void {
    if (this.#done) this.#done();
    this.#done = null;
    this.#edit = null;
  }
}

/** The kern a drag in progress sets: its start plus the pointer's travel in the run's units. */
function draggedAmount(
  state: Extract<KerningState, { type: "dragging" }>,
  ctx: KerningContext,
  pointer: ScenePoint,
): number {
  const sceneDelta = vectorBetween(scenePoint(state.origin.x, state.origin.y), pointer);
  return state.start + ctx.editor.toLocalVector(state.hit.gap.node, sceneDelta).x;
}
