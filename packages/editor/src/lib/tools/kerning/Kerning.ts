import type { Rect2D } from "@shift/geo";
import { BaseTool, type ToolName } from "../core";
import type { Canvas } from "../../editor/rendering/Canvas";
import type { CursorType } from "../../../types/editor";
import {
  KerningDrag,
  KerningEditingClose,
  KerningHover,
  KerningLabelClick,
  KerningNudge,
  KerningSelectClick,
} from "./behaviors";
import { kerningLabelLayout } from "./KerningLabel";
import { drawKerningPair } from "./KerningOverlay";
import { RunKerning, type KerningPair } from "./RunKerning";
import { trackRunLayouts } from "../spacing/RunSpacing";
import type { KerningBehavior, KerningState } from "./types";

/**
 * Kerning mode: shows and edits the kern between neighbouring glyphs in proof text.
 *
 * @remarks
 * Activating suspends glyph editing, so every glyph draws filled, and shows
 * the kern under the pointer with its value in a pill under the baseline.
 * Dragging the pair changes its kern; clicking the value opens it for typing
 * ({@link editing}); arrow keys nudge the selected pair ({@link currentPair},
 * which the sidebar's pair section edits too). Edits apply at the active
 * source. Deactivating restores glyph editing.
 */
export class KerningTool extends BaseTool<KerningState, KerningTool> {
  readonly id: ToolName = "kerning";
  readonly behaviors: KerningBehavior[] = [
    KerningEditingClose,
    KerningLabelClick,
    KerningSelectClick,
    new KerningDrag(),
    KerningNudge,
    KerningHover,
  ];
  /** The kerned pairs of the editor's text runs, which every behavior measures through. */
  readonly runs = new RunKerning(this.editor);

  #restoreEditing: (() => void) | null = null;

  override getCursor(state: KerningState): CursorType {
    if (state.type === "ready" && state.overLabel) return { type: "pointer" };
    if (state.type === "dragging") return { type: "spacing" };
    if (state.type === "ready" && state.hit) return { type: "spacing" };
    return { type: "default" };
  }

  initialState(): KerningState {
    return { type: "idle" };
  }

  override activate(): void {
    this.#restoreEditing = this.editor.editing.suspend();
    this.setState({ type: "ready", hit: null, selected: null });
  }

  override deactivate(): void {
    this.editor.font.previewKerning([]);
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    this.setState({ type: "idle" });
  }

  /**
   * The pair the sidebar shows: the one open for typing or dragged, else the
   * selected one; measured now.
   */
  get currentPair(): KerningPair | null {
    const state = this.getState();
    switch (state.type) {
      case "editing":
      case "dragging":
        return this.runs.refresh(state.hit);
      case "ready":
        return state.selected ? this.runs.refresh(state.selected) : null;
      case "idle":
        return null;
    }
  }

  /** The pair whose value is open for typing, or null. */
  get editing(): KerningPair | null {
    const state = this.getState();
    return state.type === "editing" ? state.hit : null;
  }

  /** The open value in screen pixels, for anchoring its editor. */
  editingAnchor(): Rect2D | null {
    const pair = this.editing;
    return pair ? kerningLabelLayout(this.editor, pair).amount : null;
  }

  /**
   * Sets the open pair's kern at the active source, as one undo step.
   *
   * @param amount - The new kern in units; rounded, and ignored when unchanged.
   */
  setEditedKerning(amount: number): void {
    const pair = this.editing;
    if (!pair?.set(this.editor, amount)) return;
    this.setState({ type: "editing", hit: this.runs.refresh(pair) });
  }

  /** Opens the next pair in the run, when there is one. */
  editNextPair(step: -1 | 1): void {
    const pair = this.editing;
    const next = pair ? this.runs.adjacent(pair, step) : null;
    if (next) this.setState({ type: "editing", hit: next });
  }

  /** Closes the open value and returns to hovering. */
  endEditing(): void {
    const pair = this.editing;
    if (!pair) return;
    const edited = this.runs.refresh(pair);
    this.setState({ type: "ready", hit: edited, selected: edited });
  }

  override drawOverlay(canvas: Canvas): void {
    // Runs inside the overlay's render effect: redraw when a run lays out
    // again, which follows source, location, kerning, and outline changes.
    trackRunLayouts(this.editor);
    const state = this.getState();
    switch (state.type) {
      case "idle":
        return;
      case "editing":
      case "dragging":
        drawKerningPair(canvas, this.editor, this.runs.refresh(state.hit), { selected: true });
        return;
      case "ready":
        this.#drawReady(canvas, state);
        return;
    }
  }

  /** The hovered pair and the selected one, unless a key press asked for a clear view. */
  #drawReady(canvas: Canvas, state: Extract<KerningState, { type: "ready" }>): void {
    if (state.quiet) return;
    const hit = state.hit ? this.runs.refresh(state.hit) : null;
    const selected = state.selected ? this.runs.refresh(state.selected) : null;
    if (selected && !selected.sameAs(hit)) {
      drawKerningPair(canvas, this.editor, selected, { selected: true });
    }
    if (hit) {
      drawKerningPair(canvas, this.editor, hit, {
        hovered: state.overLabel ?? false,
        selected: selected?.sameAs(hit) ?? false,
      });
    }
  }
}
