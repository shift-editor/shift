import type { AnchorId, ContourId, PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import { computed, signal, type Signal, type WritableSignal } from "@/lib/signals/signal";

export interface PointSelection {
  readonly kind: "point";
  readonly pointId: PointId;
}

export interface AnchorSelection {
  readonly kind: "anchor";
  readonly anchorId: AnchorId;
}

export interface ContourSelection {
  readonly kind: "contour";
  readonly contourId: ContourId;
}

export interface SegmentSelection {
  readonly kind: "segment";
  readonly segmentId: SegmentId;
}

export type SelectionEntry = PointSelection | AnchorSelection | ContourSelection | SegmentSelection;

export type SelectableId = PointId | AnchorId | ContourId | SegmentId;

export interface SelectionState {
  readonly entries: readonly SelectionEntry[];
}

function emptySelectionState(): SelectionState {
  return { entries: [] };
}

/**
 * Stores scene-scoped editor selection.
 *
 * Selection is identity-only state. It owns no glyph models, glyph layers, or
 * geometry-derived data; callers resolve entries against scene and font state.
 */
export class Selection {
  readonly #state: WritableSignal<SelectionState>;
  readonly stateCell: Signal<SelectionState>;

  readonly #ids: Signal<ReadonlySet<SelectableId>>;

  readonly #pointIds: Signal<ReadonlySet<PointId>>;
  readonly #anchorIds: Signal<ReadonlySet<AnchorId>>;
  readonly #contourIds: Signal<ReadonlySet<ContourId>>;
  readonly #segmentIds: Signal<ReadonlySet<SegmentId>>;

  constructor() {
    this.#state = signal<SelectionState>(emptySelectionState(), {
      name: "editor.selection.state",
    });
    this.stateCell = this.#state;
    this.#ids = computed(() => new Set(this.#state.value.entries.map(selectionId)), {
      name: "editor.selection.ids",
    });
    this.#pointIds = computed(() => pointSelectionIds(this.#state.value.entries), {
      name: "editor.selection.pointIds",
    });
    this.#anchorIds = computed(() => anchorSelectionIds(this.#state.value.entries), {
      name: "editor.selection.anchorIds",
    });
    this.#contourIds = computed(() => contourSelectionIds(this.#state.value.entries), {
      name: "editor.selection.contourIds",
    });
    this.#segmentIds = computed(() => segmentSelectionIds(this.#state.value.entries), {
      name: "editor.selection.segmentIds",
    });
  }

  get snapshot(): SelectionState {
    return this.#state.peek();
  }

  get entries(): readonly SelectionEntry[] {
    return this.#state.peek().entries;
  }

  get points(): readonly PointSelection[] {
    return this.entries.filter((entry): entry is PointSelection => entry.kind === "point");
  }

  get anchors(): readonly AnchorSelection[] {
    return this.entries.filter((entry): entry is AnchorSelection => entry.kind === "anchor");
  }

  get contours(): readonly ContourSelection[] {
    return this.entries.filter((entry): entry is ContourSelection => entry.kind === "contour");
  }

  get segments(): readonly SegmentSelection[] {
    return this.entries.filter((entry): entry is SegmentSelection => entry.kind === "segment");
  }

  get pointIds(): ReadonlySet<PointId> {
    return this.#pointIds.peek();
  }

  get anchorIds(): ReadonlySet<AnchorId> {
    return this.#anchorIds.peek();
  }

  get contourIds(): ReadonlySet<ContourId> {
    return this.#contourIds.peek();
  }

  get segmentIds(): ReadonlySet<SegmentId> {
    return this.#segmentIds.peek();
  }

  isSelected(entry: SelectionEntry): boolean {
    return this.has(selectionId(entry));
  }

  has(id: SelectableId): boolean {
    return this.#ids.peek().has(id);
  }

  hasSelection(): boolean {
    return this.entries.length > 0;
  }

  select(entries: readonly SelectionEntry[]): void {
    this.#state.set({ entries: uniqueEntries(entries) });
  }

  add(entry: SelectionEntry): void {
    if (this.isSelected(entry)) return;

    this.#state.set({ entries: [...this.entries, entry] });
  }

  remove(entry: SelectionEntry): void {
    if (!this.isSelected(entry)) return;

    const id = selectionId(entry);
    this.#state.set({
      entries: this.entries.filter((selected) => selectionId(selected) !== id),
    });
  }

  toggle(entry: SelectionEntry): void {
    if (this.isSelected(entry)) {
      this.remove(entry);
      return;
    }

    this.add(entry);
  }

  clear(): void {
    if (this.entries.length === 0) return;

    this.#state.set(emptySelectionState());
  }
}

function uniqueEntries(entries: readonly SelectionEntry[]): readonly SelectionEntry[] {
  const seen = new Set<SelectableId>();
  const unique: SelectionEntry[] = [];

  for (const entry of entries) {
    const id = selectionId(entry);
    if (seen.has(id)) continue;

    seen.add(id);
    unique.push(entry);
  }

  return unique;
}

function selectionId(entry: SelectionEntry): SelectableId {
  switch (entry.kind) {
    case "point":
      return entry.pointId;
    case "anchor":
      return entry.anchorId;
    case "contour":
      return entry.contourId;
    case "segment":
      return entry.segmentId;
  }
}

function pointSelectionIds(entries: readonly SelectionEntry[]): ReadonlySet<PointId> {
  const ids = new Set<PointId>();
  for (const entry of entries) {
    if (entry.kind === "point") ids.add(entry.pointId);
  }
  return ids;
}

function anchorSelectionIds(entries: readonly SelectionEntry[]): ReadonlySet<AnchorId> {
  const ids = new Set<AnchorId>();
  for (const entry of entries) {
    if (entry.kind === "anchor") ids.add(entry.anchorId);
  }
  return ids;
}

function contourSelectionIds(entries: readonly SelectionEntry[]): ReadonlySet<ContourId> {
  const ids = new Set<ContourId>();
  for (const entry of entries) {
    if (entry.kind === "contour") ids.add(entry.contourId);
  }
  return ids;
}

function segmentSelectionIds(entries: readonly SelectionEntry[]): ReadonlySet<SegmentId> {
  const ids = new Set<SegmentId>();
  for (const entry of entries) {
    if (entry.kind === "segment") ids.add(entry.segmentId);
  }
  return ids;
}
