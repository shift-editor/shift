import { BaseTool, type ToolName } from "../core";
import type { Canvas } from "../../editor/rendering/Canvas";
import type { CursorType } from "../../../types/editor";
import type { Rect2D } from "@shift/geo";
import {
  followedHit,
  setSidebearing,
  SpacingDrag,
  SpacingEditingClose,
  SpacingHover,
  SpacingLabelClick,
  SpacingNudge,
  SpacingSelectClick,
} from "./behaviors";
import { spacingLabelRect } from "./SpacingLabel";
import { drawSpacingGap } from "./SpacingGapOverlay";
import type { SpacingBehavior, SpacingHit, SpacingState } from "./types";

/** Whether two hits are the same gap, by its two glyphs. */
function sameGapItems(a: SpacingHit, b: SpacingHit): boolean {
  return (
    a.gap.node.id === b.gap.node.id &&
    a.gap.left?.itemId === b.gap.left?.itemId &&
    a.gap.right?.itemId === b.gap.right?.itemId
  );
}

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
export class SpacingTool extends BaseTool<SpacingState> {
  readonly id: ToolName = "spacing";
  readonly behaviors: SpacingBehavior[] = [
    SpacingEditingClose,
    SpacingLabelClick,
    SpacingSelectClick,
    new SpacingDrag(),
    SpacingNudge,
    SpacingHover,
  ];

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

  /**
   * The half holding the dragged glyph's other sidebearing: for a right
   * sidebearing, the gap before that glyph; for a left one, the gap after it.
   */
  #otherSidebearingHit(dragged: SpacingHit): SpacingHit | null {
    const itemId = dragged.gap[dragged.side]?.itemId;
    if (!itemId) return null;

    const gaps = this.editor.nodeDefinition("textRun").spacingGaps(dragged.gap.node);
    const side = dragged.side === "left" ? "right" : "left";
    const gap = gaps.find((candidate) => candidate[side]?.itemId === itemId);
    return gap ? { gap, side } : null;
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

  /** The half whose value is open for typing, or null. */
  get editing(): SpacingHit | null {
    const state = this.getState();
    return state.type === "editing" ? state.hit : null;
  }

  /** The open value's pill in screen pixels, for anchoring its editor. */
  editingAnchor(): Rect2D | null {
    const hit = this.editing;
    return hit ? spacingLabelRect(this.editor, hit.gap, hit.side) : null;
  }

  /**
   * Sets the open half's sidebearing at the active source, as one undo step.
   *
   * @param value - The new sidebearing in units; rounded, and ignored when unchanged.
   */
  setEditedSidebearing(value: number): void {
    const hit = this.editing;
    if (!hit || !setSidebearing(this.editor, hit, value)) return;
    this.setState({ type: "editing", hit: followedHit(this.editor, hit) });
  }

  /** Opens the other half of the same gap, when it has one. */
  switchEditedSide(): void {
    const hit = this.editing;
    if (!hit) return;
    const side = hit.side === "left" ? "right" : "left";
    if (hit.gap[side]) this.setState({ type: "editing", hit: { gap: hit.gap, side } });
  }

  /** Closes the open value and returns to hovering. */
  endEditing(): void {
    const hit = this.editing;
    if (!hit) return;
    const edited = followedHit(this.editor, hit);
    this.setState({ type: "ready", hit: edited, selected: edited });
  }

  override drawOverlay(canvas: Canvas): void {
    const state = this.getState();
    if (state.type === "idle") return;
    if (state.type === "dragging") {
      const otherHalf = state.hit.side === "left" ? "right" : "left";
      drawSpacingGap(canvas, this.editor, state.hit.gap, state.hit.side, {
        matched: state.snap === "otherHalf" ? otherHalf : null,
        snapped: state.snap !== null,
      });
      const matched =
        state.snap === "otherSidebearing" ? this.#otherSidebearingHit(state.hit) : null;
      if (matched) {
        drawSpacingGap(canvas, this.editor, matched.gap, matched.side, { snapped: true });
      }
      return;
    }
    if (state.type === "editing") {
      drawSpacingGap(canvas, this.editor, state.hit.gap, state.hit.side);
      return;
    }
    if (state.quiet) return;

    const { hit, selected } = state;
    const selectedHere = selected && hit && sameGapItems(selected, hit);
    if (selected && !selectedHere) {
      drawSpacingGap(canvas, this.editor, selected.gap, selected.side, { selected: selected.side });
    }
    if (hit) {
      drawSpacingGap(canvas, this.editor, hit.gap, hit.side, {
        labelHovered: Boolean(state.overLabel),
        selected: selectedHere ? selected.side : null,
      });
    }
  }
}
