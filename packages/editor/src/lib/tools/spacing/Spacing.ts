import type { Rect2D } from "@shift/geo";
import { BaseTool, type ToolName } from "../core";
import type { Canvas } from "../../editor/rendering/Canvas";
import type { CursorType } from "../../../types/editor";
import {
  SpacingDrag,
  SpacingEditingClose,
  SpacingHover,
  SpacingLabelClick,
  SpacingNudge,
  SpacingSelectClick,
} from "./behaviors";
import { RunSpacing, trackRunLayouts, type SpacingHalf } from "./RunSpacing";
import { spacingLabelRect } from "./SpacingLabel";
import { drawSpacingGap } from "./SpacingGapOverlay";
import type { SpacingBehavior, SpacingState } from "./types";

/**
 * Spacing mode: shows the space between glyphs in proof text.
 *
 * @remarks
 * Activating suspends glyph editing, so every glyph draws filled, and shows
 * the gap under the pointer as two halves, the left glyph's right sidebearing
 * and the right glyph's left one, with the half under the pointer strongest.
 * Dragging anywhere in the gap changes that half's sidebearing; clicking its
 * value pill opens the value for typing ({@link editing}); clicking elsewhere
 * in it selects it for the arrow keys, which hide the overlays while they
 * nudge. Deactivating restores glyph editing on the current glyph.
 */
export class SpacingTool extends BaseTool<SpacingState, SpacingTool> {
  readonly id: ToolName = "spacing";
  readonly behaviors: SpacingBehavior[] = [
    SpacingEditingClose,
    SpacingLabelClick,
    SpacingSelectClick,
    new SpacingDrag(),
    SpacingNudge,
    SpacingHover,
  ];
  /** The gaps of the editor's text runs, which every behavior measures through. */
  readonly runs = new RunSpacing(this.editor);

  #restoreEditing: (() => void) | null = null;
  #wasEditing = false;

  override getCursor(state: SpacingState): CursorType {
    if (state.type === "ready" && state.overLabel) return { type: "pointer" };
    if (state.type === "dragging") return { type: "spacing" };
    if (state.type === "ready" && state.hit) return { type: "spacing" };
    return { type: "default" };
  }

  initialState(): SpacingState {
    return { type: "idle" };
  }

  override activate(): void {
    this.#wasEditing = this.editor.editing.hasScope();
    this.#restoreEditing = this.editor.editing.suspend();
    this.setState({ type: "ready", hit: null, selected: null });
  }

  override deactivate(): void {
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    // Selecting a half switches the run's current glyph; edit that one on return.
    if (this.#wasEditing && !this.editor.editing.hasScope()) this.#editCurrentGlyph();
    this.setState({ type: "idle" });
  }

  /** The half whose value is open for typing, measured now, or null. */
  get editing(): SpacingHalf | null {
    const state = this.getState();
    return state.type === "editing" ? this.runs.refresh(state.hit) : null;
  }

  /**
   * The half being worked on: the one open for typing or dragged, else the
   * selected one; measured now, so null once its glyphs are gone.
   */
  get currentHalf(): SpacingHalf | null {
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

  /** The open value's pill in screen pixels, for anchoring its editor. */
  editingAnchor(): Rect2D | null {
    const half = this.editing;
    return half ? spacingLabelRect(this.editor, half) : null;
  }

  /**
   * Sets the open half's sidebearing at the active source, as one undo step.
   *
   * @param value - The new sidebearing in units; rounded, and ignored when unchanged.
   */
  setEditedSidebearing(value: number): void {
    const half = this.editing;
    if (!half?.set(this.editor, value)) return;
    const hit = this.runs.refresh(half);
    this.setState(hit ? { type: "editing", hit } : { type: "ready", hit: null, selected: null });
  }

  /** Opens the other half of the same gap, when it has one. */
  switchEditedSide(): void {
    const other = this.editing?.other();
    if (other) this.setState({ type: "editing", hit: other });
  }

  /** Closes the open value and returns to hovering. */
  endEditing(): void {
    const half = this.editing;
    if (!half) return;
    const edited = this.runs.refresh(half);
    this.setState({ type: "ready", hit: edited, selected: edited });
  }

  override drawOverlay(canvas: Canvas): void {
    // Runs inside the overlay's render effect: redraw when a run lays out
    // again, which follows source, location, and outline changes.
    trackRunLayouts(this.editor);
    const state = this.getState();
    switch (state.type) {
      case "idle":
        return;
      case "editing": {
        const half = this.runs.refresh(state.hit);
        if (half) drawSpacingGap(canvas, this.editor, half);
        return;
      }
      case "dragging":
        this.#drawDrag(canvas, state);
        return;
      case "ready":
        this.#drawReady(canvas, state);
        return;
    }
  }

  /** The dragged gap, and the gap holding the matched value when the drag snapped to the glyph's other side. */
  #drawDrag(canvas: Canvas, state: Extract<SpacingState, { type: "dragging" }>): void {
    const hit = this.runs.refresh(state.hit);
    if (!hit) return;
    drawSpacingGap(canvas, this.editor, hit, {
      matched: state.snap === "otherHalf",
      snapped: state.snap !== null,
    });
    if (state.snap !== "otherSidebearing") return;

    const opposite = this.runs.oppositeHalf(hit);
    if (opposite) drawSpacingGap(canvas, this.editor, opposite, { snapped: true });
  }

  /** The hovered gap and the selected half, unless a key press asked for a clear view. */
  #drawReady(canvas: Canvas, state: Extract<SpacingState, { type: "ready" }>): void {
    if (state.quiet) return;
    // Measured now: an undo may have taken either half's glyphs away.
    const hit = state.hit ? this.runs.refresh(state.hit) : null;
    const selected = state.selected ? this.runs.refresh(state.selected) : null;
    const selectedHere = selected !== null && hit !== null && selected.sameGapAs(hit);
    if (selected && !selectedHere) {
      drawSpacingGap(canvas, this.editor, selected, { selected: selected.side });
    }
    if (hit) {
      drawSpacingGap(canvas, this.editor, hit, {
        labelHovered: Boolean(state.overLabel),
        selected: selectedHere ? selected.side : null,
      });
    }
  }

  #editCurrentGlyph(): void {
    const definition = this.editor.nodeDefinition("textRun");
    for (const run of this.editor.scene.nodesOfKind("textRun")) {
      const child = definition.childGlyph(run);
      if (child) {
        this.editor.editing.enter(child.id);
        return;
      }
    }
  }
}
