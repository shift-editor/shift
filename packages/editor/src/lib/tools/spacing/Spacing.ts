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
import { RunSpacing, SpacingHalf, trackRunLayouts } from "./RunSpacing";
import { spacingLabelRect } from "./SpacingLabel";
import { drawSpacingGap } from "./SpacingGapOverlay";
import { drawAdvanceTees } from "./AdvanceTees";
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
 * in it selects it for the arrow keys. While a drag, nudge, or typed value
 * changes spacing, nothing is drawn over it, so the spacing reads as it is;
 * a snapped drag shows only the two equal sidebearings. In a kerned gap each glyph's own sidebearing shows where it
 * reaches, measured to its own advance edge
 * whatever the kerning; the rest of the space between the boundaries is the
 * kern, which is the Kerning tool's. Deactivating restores glyph editing on the current
 * glyph.
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

  /** The half under the pointer while hovering or dragging, as last hit, or null. */
  get hovered(): SpacingHalf | null {
    const state = this.getState();
    return state.type === "ready" || state.type === "dragging" ? state.hit : null;
  }

  /** The half selected for the arrow keys while hovering, measured now, or null. */
  get selected(): SpacingHalf | null {
    const state = this.getState();
    return state.type === "ready" && state.selected ? this.runs.refresh(state.selected) : null;
  }

  /** Whether the pointer is over the hovered half's value pill, which opens on click. */
  get overValue(): boolean {
    const state = this.getState();
    return state.type === "ready" && state.overLabel === true;
  }

  /** Whether a nudge has hidden every overlay until the pointer moves. */
  get quiet(): boolean {
    const state = this.getState();
    return state.type === "ready" && state.quiet === true;
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
    // Hidden while a drag or nudge moves the spacing, so it reads unobstructed.
    const moving = state.type === "dragging" || (state.type === "ready" && state.quiet);
    if (state.type !== "idle" && !moving) drawAdvanceTees(canvas, this.editor);
    switch (state.type) {
      case "idle":
        return;
      case "editing":
        // Nothing over the spacing while it changes, so it reads as it is.
        return;
      case "dragging":
        this.#drawSnap(canvas, state);
        return;
      case "ready":
        this.#drawReady(canvas, state);
        return;
    }
  }

  /**
   * While a drag is snapped, and only then, shows the two equal sidebearings
   * with their hatching and pills: the dragged one and the one it matched.
   */
  #drawSnap(canvas: Canvas, state: Extract<SpacingState, { type: "dragging" }>): void {
    if (!state.snap) return;
    const hit = this.runs.refresh(state.hit);
    if (!hit) return;
    const matched = state.snap === "otherHalf" ? hit.other() : this.runs.oppositeHalf(hit);
    for (const half of [hit, matched]) {
      if (half) {
        drawSpacingGap(canvas, this.editor, new SpacingHalf(half.gap, half.side, "glyph"), {
          snapped: true,
        });
      }
    }
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
      this.#drawEchoes(canvas, hit);
      drawSpacingGap(canvas, this.editor, hit, {
        labelHovered: Boolean(state.overLabel),
        selected: selectedHere ? selected.side : null,
      });
    }
  }

  /** The same sidebearing everywhere else it appears, which an edit to `half` changes too. */
  #drawEchoes(canvas: Canvas, half: SpacingHalf): void {
    for (const echo of this.runs.sameSidebearings(half)) {
      drawSpacingGap(canvas, this.editor, echo, { echo: true });
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
