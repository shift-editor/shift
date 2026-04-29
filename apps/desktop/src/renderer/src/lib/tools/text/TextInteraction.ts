/**
 * TextInteraction — per-run UI focus state. Sibling of TextBuffer; both are
 * composed by TextRun.
 *
 * Owns:
 *   - editing slot — which cell index in the run is open for in-place glyph
 *     editing (set when the user double-clicks a slot to dive into editing
 *     the glyph at that position)
 *   - suspended editing — what was active before the user exited the Text
 *     tool, so re-activation can restore it
 *   - hover index — slot under the pointer for visual highlight
 *
 * Per-field signals so a hover update doesn't refire editing-slot subscribers.
 * `#update(patch)` batches multi-field mutations.
 *
 * Does NOT own: cells, cursor, anchor, originX (TextBuffer), layout/caret
 * (TextRun), cursorVisible (TextRun). Composite-glyph drill-through state
 * will live in its own `CompositeInspection` class when that feature is
 * rebuilt — intentionally not folded in here.
 */
import { signal, batch, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { Cell } from "./layout";

export interface EditingTarget {
  index: number;
  cell: Cell;
}

interface TextInteractionState {
  editing?: EditingTarget | null;
  suspended?: EditingTarget | null;
  hoveredIndex?: number | null;
}

export type TextInteractionSnapshot = TextInteractionState;

export class TextInteraction {
  readonly #$editing: WritableSignal<EditingTarget | null>;
  readonly #$suspended: WritableSignal<EditingTarget | null>;
  readonly #$hoveredIndex: WritableSignal<number | null>;

  constructor() {
    this.#$editing = signal<EditingTarget | null>(null);
    this.#$suspended = signal<EditingTarget | null>(null);
    this.#$hoveredIndex = signal<number | null>(null);
  }

  get editing(): EditingTarget | null {
    return this.#$editing.value;
  }

  get suspended(): EditingTarget | null {
    return this.#$suspended.value;
  }

  get hoveredIndex(): number | null {
    return this.#$hoveredIndex.value;
  }

  /** @knipclassignore — read by TextRunRenderer / TextRunEdit (TODO) */
  get $editing(): Signal<EditingTarget | null> {
    return this.#$editing;
  }

  /** @knipclassignore — read by TextRunRenderer / TextRunHover (TODO) */
  get $hoveredIndex(): Signal<number | null> {
    return this.#$hoveredIndex;
  }

  /**
   * Open in-place editing for the cell at `index`. Replaces whatever was
   * being edited before.
   */
  setEditing(target: EditingTarget | null): void {
    this.#$editing.set(target);
  }

  /**
   * Move current editing → suspended; clear editing. Used when the user
   * exits the Text tool — the editing slot is remembered so re-entry can
   * restore it.
   */
  suspend(): void {
    if (this.#$suspended.value) return;

    const suspended = this.#$editing.value;
    this.#update({
      suspended,
      editing: null,
    });
  }

  /**
   * Move suspended → editing; clear suspended. Returns the restored target,
   * or null if nothing was suspended.
   */
  resume(): EditingTarget | null {
    const editing = this.#$suspended.value;

    this.#update({
      suspended: null,
      editing: editing,
    });

    return editing;
  }

  setHovered(index: number | null): void {
    this.#$hoveredIndex.set(index);
  }

  /**
   * Adjust held indices (editing, suspended) after a buffer mutation at `at`
   * that removed `deleteCount` cells and inserted `insertCount` in their
   * place. Indices that fell within the removed range become null; indices
   * after the mutation shift by `insertCount - deleteCount`.
   *
   * Covers all three operations:
   *   - delete-only: adjustForBufferChange(start, count, 0)
   *   - insert-only: adjustForBufferChange(at, 0, count)
   *   - replace:     adjustForBufferChange(start, deleteCount, insertCount)
   *
   * Examples (editing target shown above the buffer):
   *
   *   editing.index = 4  →  delete cells 1..4 (at=1, count=3, insert=0):
   *     before:  [A, B, C, D, E, F]    index 4 = E
   *     after:   [A, E, F]             index 1 (shifted left by 3)
   *
   *   editing.index = 3  →  delete cell 3 (at=3, count=1, insert=0):
   *     before:  [A, B, C, D, E]       index 3 = D (the held cell)
   *     after:   [A, B, C, E]          editing → null  (D was deleted)
   *
   *   editing.index = 3  →  insert 2 at index 1 (at=1, count=0, insert=2):
   *     before:  [A, B, C, D, E]       index 3 = D
   *     after:   [A, X, Y, B, C, D, E] index 5 (shifted right by 2)
   *
   * Called by TextRun after every TextBuffer mutation that changes cell
   * positions, to keep the editing context coherent with the buffer.
   */
  adjustForBufferChange(at: number, deleteCount: number, insertCount: number): void {
    const adjust = (t: EditingTarget | null): EditingTarget | null => {
      if (!t) return null;
      let i = t.index;

      if (deleteCount > 0) {
        if (i >= at && i < at + deleteCount) return null;
        if (i >= at + deleteCount) i -= deleteCount;
      }
      if (insertCount > 0 && i >= at) {
        i += insertCount;
      }

      return i === t.index ? t : { ...t, index: i };
    };

    this.#update({
      editing: adjust(this.editing),
      suspended: adjust(this.suspended),
    });
  }

  /** Reset everything to null. */
  clear(): void {
    this.#update({
      editing: null,
      suspended: null,
      hoveredIndex: null,
    });
  }

  snapshot(): TextInteractionSnapshot {
    return {
      editing: this.editing,
      suspended: this.suspended,
      hoveredIndex: this.hoveredIndex,
    };
  }

  restore(snapshot: TextInteractionSnapshot): void {
    this.#update(snapshot);
  }

  #update(patch: TextInteractionState): void {
    batch(() => {
      if (patch.editing !== undefined) this.#$editing.set(patch.editing);
      if (patch.suspended !== undefined) this.#$suspended.set(patch.suspended);
      if (patch.hoveredIndex !== undefined) this.#$hoveredIndex.set(patch.hoveredIndex);
    });
  }
}
