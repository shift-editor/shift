/**
 * TextBuffer — pure logical state of an editable text run.
 *
 * Owns: item buffer + cursor + anchor + originX.
 *
 * Selection model: DOM-style (anchor / focus).
 *   - anchor: where the selection started (stays during shift+arrow)
 *   - cursor: where the caret is (moves during shift+arrow)
 *   - anchor === cursor → no selection, just a caret
 *   - anchor !== cursor → selection from min(...) to max(...)
 *
 * Per-field signals so consumers subscribe only to what they need:
 * a cursor move does not refire `itemsCell` subscribers. Multi-field
 * mutations go through `#update(patch)` which batches all signal sets,
 * keeping the `batch(() => ...)` boilerplate out of every method.
 *
 * Does NOT own: hover, editing-context, layout, caret geometry,
 * cursorVisible (transient UI state). Those live in `TextInteraction` /
 * `TextRun`.
 */
import {
  signal,
  batch,
  type WritableSignal,
  type Signal,
} from "@/lib/signals/signal";
import type { TextItem, TextItemId } from "./layout";
import { clamp } from "@/lib/utils/utils";

export interface SelectionRange {
  start: number;
  end: number;
}

/** All-fields-required snapshot of a TextBuffer; safe to round-trip through persistence. */
export interface TextBufferSnapshot {
  items: TextItem[];
  cursor: number;
  anchor: number;
  originX: number;
}

/** Patch shape for `#update`. Any field omitted is left alone. */
interface TextBufferPatch {
  items?: readonly TextItem[];
  cursor?: number;
  anchor?: number;
  originX?: number;
}

export class TextBuffer {
  readonly #items: WritableSignal<readonly TextItem[]>;
  readonly #cursor: WritableSignal<number>;
  readonly #anchor: WritableSignal<number>;
  readonly #originX: WritableSignal<number>;

  constructor() {
    this.#items = signal<readonly TextItem[]>([]);
    this.#cursor = signal(0);
    this.#anchor = signal(0);
    this.#originX = signal(0);
  }

  get items(): readonly TextItem[] {
    return this.#items.peek();
  }

  get cursor(): number {
    return this.#cursor.peek();
  }

  get anchor(): number {
    return this.#anchor.peek();
  }

  get originX(): number {
    return this.#originX.peek();
  }

  get length(): number {
    return this.#items.peek().length;
  }

  get hasSelection(): boolean {
    return this.#anchor.peek() !== this.#cursor.peek();
  }

  /**
   * Always-defined selection span. Collapses to `{start: cursor, end: cursor}`
   * when there's no active selection. Mutators use this so they don't have to
   * branch on null — `slice(0, start) + slice(end)` is the same splice math
   * whether or not a selection exists.
   *
   *   anchor=3, cursor=1 (backward selection):
   *     [A, B, C, D]                  range = { start: 1, end: 3 }   → B, C
   *
   *   no selection (anchor=cursor=2):
   *     [A, B, C, D]                  range = { start: 2, end: 2 }   → empty
   */
  get range(): SelectionRange {
    const a = this.#anchor.peek();
    const c = this.#cursor.peek();
    return { start: Math.min(a, c), end: Math.max(a, c) };
  }

  /** @knipclassignore — read by HiddenTextInput's copy handler */
  get selectedItems(): TextItem[] {
    if (!this.hasSelection) return [];
    const { start, end } = this.range;
    return this.#items.peek().slice(start, end);
  }

  itemById(id: TextItemId): TextItem | null {
    return this.#items.peek().find((item) => item.id === id) ?? null;
  }

  get itemsCell(): Signal<readonly TextItem[]> {
    return this.#items;
  }

  get cursorCell(): Signal<number> {
    return this.#cursor;
  }

  get anchorCell(): Signal<number> {
    return this.#anchor;
  }

  get originXCell(): Signal<number> {
    return this.#originX;
  }

  /**
   * Insert one item at the cursor. Replaces the current selection
   * (if any) before inserting. Cursor and anchor advance to the
   * position immediately after the inserted item.
   *
   *   no selection (cursor=2):
   *     before:  [A, B, C]            cursor = anchor = 2
   *     insert(X)
   *     after:   [A, B, X, C]         cursor = anchor = 3
   *
   *   with selection (anchor=1, cursor=3):
   *     before:  [A, B, C, D]         selection = [1, 3)  → B, C
   *     insert(X)
   *     after:   [A, X, D]            cursor = anchor = 2
   */
  insert(item: TextItem): void {
    const { start, end } = this.range;
    const next = [
      ...this.items.slice(0, start),
      item,
      ...this.items.slice(end),
    ];
    const pos = start + 1;

    this.#update({ items: next, cursor: pos, anchor: pos });
  }

  /**
   * Insert many items at the cursor. Replaces the current selection.
   * Cursor and anchor land at `start + items.length`.
   */
  insertMany(items: readonly TextItem[]): void {
    const { start, end } = this.range;
    const next = [
      ...this.items.slice(0, start),
      ...items,
      ...this.items.slice(end),
    ];
    const pos = start + items.length;

    this.#update({ items: next, cursor: pos, anchor: pos });
  }

  /**
   * Insert at a specific buffer index, ignoring current selection.
   * Existing cursor/anchor shift right by 1 if they sit at or after `index`.
   */
  /** @knipclassignore — used by Select tool's TextRunEdit splice (TODO) */
  insertAt(index: number, item: TextItem): void {
    const at = clamp(index, 0, this.length);
    const next = [...this.items.slice(0, at), item, ...this.items.slice(at)];
    this.#update({
      items: next,
      cursor: this.cursor >= at ? this.cursor + 1 : this.cursor,
      anchor: this.anchor >= at ? this.anchor + 1 : this.anchor,
    });
  }

  /**
   * Backspace. If a selection is active, deletes the selection;
   * cursor lands at selection start. Otherwise deletes one item
   * before the cursor.
   *
   * Returns true when something was deleted, false when there's
   * nothing to delete (cursor at start, no selection).
   */
  delete(): boolean {
    if (this.hasSelection) {
      const { start, end } = this.range;
      const next = [...this.items.slice(0, start), ...this.items.slice(end)];
      this.#update({ items: next, cursor: start, anchor: start });
      return true;
    }

    if (this.cursor === 0) return false;

    const pos = this.cursor - 1;
    const next = [...this.items.slice(0, pos), ...this.items.slice(pos + 1)];
    this.#update({ items: next, cursor: pos, anchor: pos });
    return true;
  }

  /**
   * Forward delete. If a selection is active, deletes it; cursor
   * lands at selection start. Otherwise deletes the item at cursor.
   */
  deleteForward(): boolean {
    if (this.hasSelection) {
      const { start, end } = this.range;
      const next = [...this.items.slice(0, start), ...this.items.slice(end)];
      this.#update({ items: next, cursor: start, anchor: start });
      return true;
    }

    if (this.cursor >= this.length) return false;

    const next = [
      ...this.items.slice(0, this.cursor),
      ...this.items.slice(this.cursor + 1),
    ];
    this.#update({ items: next });
    return true;
  }

  /**
   * Place caret at `index` (clamped to [0, length]). Anchor === cursor,
   * collapsing any selection.
   */
  placeCaret(index: number): void {
    const pos = clamp(index, 0, this.length);
    this.#update({ cursor: pos, anchor: pos });
  }

  /**
   * Move cursor to `index`, leaving anchor untouched. Used by
   * shift+arrow / shift+click to extend the selection.
   */
  extendSelection(index: number): void {
    this.#cursor.set(clamp(index, 0, this.length));
  }

  /**
   * Set anchor and cursor explicitly. Both clamped to [0, length].
   */
  selectRange(anchor: number, cursor: number): void {
    const len = this.length;
    this.#update({
      anchor: clamp(anchor, 0, len),
      cursor: clamp(cursor, 0, len),
    });
  }

  /** anchor=0, cursor=length. */
  selectAll(): void {
    this.#update({ anchor: 0, cursor: this.length });
  }

  /**
   * Collapse selection to its `start` or `end`. No-op when there's
   * no selection.
   */
  /** @knipclassignore — public buffer API */
  collapseSelection(to: "start" | "end"): void {
    if (!this.hasSelection) return;
    const { start, end } = this.range;
    const pos = to === "start" ? start : end;
    this.#update({ cursor: pos, anchor: pos });
  }

  setOriginX(x: number): void {
    this.#originX.set(x);
  }

  /**
   * Initialize with a single item if and only if the buffer is empty.
   * Cursor + anchor land at index 1. Used by Text tool activation to
   * plant the active glyph.
   */
  seed(item: TextItem): void {
    if (this.length > 0) return;
    this.#update({ items: [item], cursor: 1, anchor: 1 });
  }

  /** Empty the buffer; cursor/anchor/originX reset to 0. */
  clear(): void {
    this.#update({ items: [], cursor: 0, anchor: 0, originX: 0 });
  }

  snapshot(): TextBufferSnapshot {
    return {
      items: [...this.items],
      cursor: this.cursor,
      anchor: this.anchor,
      originX: this.originX,
    };
  }

  restore(snapshot: TextBufferSnapshot): void {
    this.#update(snapshot);
  }

  /**
   * Apply a partial state patch atomically. Any field omitted is left alone.
   * All signal sets run inside `batch()` so subscribers see one transition,
   * not intermediate states.
   */
  #update(patch: TextBufferPatch): void {
    batch(() => {
      if (patch.items !== undefined) this.#items.set(patch.items);
      if (patch.cursor !== undefined) this.#cursor.set(patch.cursor);
      if (patch.anchor !== undefined) this.#anchor.set(patch.anchor);
      if (patch.originX !== undefined) this.#originX.set(patch.originX);
    });
  }
}
