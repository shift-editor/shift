import { Bounds, type Bounds as BoundsType } from "@shift/geo";
import type { AnchorId, ContourId, PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import type { GlyphSource } from "@/lib/model/Glyph";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";

/** Discriminated reference to any selectable entity. */
export type Selectable =
  | { kind: "point"; id: PointId }
  | { kind: "anchor"; id: AnchorId }
  | { kind: "segment"; id: SegmentId };

export interface SelectionState {
  readonly pointIds: ReadonlySet<PointId>;
  readonly anchorIds: ReadonlySet<AnchorId>;
  readonly segmentIds: ReadonlySet<SegmentId>;
}

interface DerivedSelection {
  readonly contourIds: ReadonlySet<ContourId>;
  readonly bounds: BoundsType | null;
}

const EMPTY_DERIVED: DerivedSelection = {
  contourIds: new Set(),
  bounds: null,
};

function emptySelectionState(): SelectionState {
  return {
    pointIds: new Set(),
    anchorIds: new Set(),
    segmentIds: new Set(),
  };
}

/**
 * Committed editor selection with computed contour queries.
 *
 * Selection owns selected IDs. Geometry owns object and parent lookups.
 */
export class Selection {
  readonly #glyphSource: Signal<GlyphSource | null>;
  readonly #state: WritableSignal<SelectionState>;
  readonly #derived: ComputedSignal<DerivedSelection>;
  readonly #bounds: ComputedSignal<BoundsType | null>;
  readonly stateCell: Signal<SelectionState>;
  readonly boundsCell: Signal<BoundsType | null>;

  constructor(glyphSource: Signal<GlyphSource | null>) {
    this.#glyphSource = glyphSource;
    this.#state = signal<SelectionState>(emptySelectionState(), {
      name: "editor.selection.state",
    });

    this.#derived = computed(
      () => {
        const state = this.#state.value;
        const pointIds = state.pointIds;
        const glyphSource = this.#glyphSource.value;

        if (!glyphSource) return EMPTY_DERIVED;
        if (pointIds.size === 0) return EMPTY_DERIVED;

        glyphSource.coordinateBuffersChangedCell.value;

        const contourIds = new Set<ContourId>();

        for (const pointId of pointIds) {
          const contourId = glyphSource.contourIdOfPoint(pointId);
          if (contourId) contourIds.add(contourId);
        }

        let bounds: BoundsType | null = null;
        if (this.segmentIds.size !== 0) {
          for (const segment of this.segmentIds) {
            const s = glyphSource.geometry.segment(segment);
            if (!s) continue;
            bounds = Bounds.unionAll([bounds, s.bounds]);
          }

          return { contourIds, bounds };
        }

        const points = glyphSource.positionsFor(
          [...pointIds].map((id) => ({ kind: "point" as const, id })),
        );
        bounds = Bounds.fromPoints(points);

        return { contourIds, bounds };
      },
      { name: "editor.selection.derived" },
    );
    this.#bounds = computed(() => this.#derived.value.bounds, {
      name: "editor.selection.bounds",
    });
    this.stateCell = this.#state;
    this.boundsCell = this.#bounds;
  }

  get snapshot(): SelectionState {
    return this.#state.peek();
  }

  get pointIds(): ReadonlySet<PointId> {
    return this.#state.peek().pointIds;
  }

  get anchorIds(): ReadonlySet<AnchorId> {
    return this.#state.peek().anchorIds;
  }

  get segmentIds(): ReadonlySet<SegmentId> {
    return this.#state.peek().segmentIds;
  }

  /** @knipclassignore - used by BooleanOps and upcoming callers */
  get contourIds(): ReadonlySet<ContourId> {
    return this.#derived.peek().contourIds;
  }

  get bounds(): BoundsType | null {
    return this.#bounds.peek();
  }

  isSelected(item: Selectable): boolean {
    const state = this.#state.peek();
    switch (item.kind) {
      case "point":
        return state.pointIds.has(item.id);
      case "anchor":
        return state.anchorIds.has(item.id);
      case "segment":
        return state.segmentIds.has(item.id);
    }
  }

  hasSelection(): boolean {
    const state = this.#state.peek();
    return (
      state.pointIds.size > 0 ||
      state.anchorIds.size > 0 ||
      state.segmentIds.size > 0
    );
  }

  selected(): Selectable[] {
    const state = this.#state.peek();

    return [
      ...[...state.pointIds].map((id) => ({ kind: "point", id }) as const),
      ...[...state.anchorIds].map((id) => ({ kind: "anchor", id }) as const),
      ...[...state.segmentIds].map((id) => ({ kind: "segment", id }) as const),
    ];
  }

  /** Replace entire selection with the given items. Clears everything first. */
  select(items: readonly Selectable[]): void {
    const pointIds = new Set<PointId>();
    const anchorIds = new Set<AnchorId>();
    const segmentIds = new Set<SegmentId>();

    for (const item of items) {
      switch (item.kind) {
        case "point":
          pointIds.add(item.id);
          break;
        case "anchor":
          anchorIds.add(item.id);
          break;
        case "segment":
          segmentIds.add(item.id);
          break;
      }
    }

    this.#state.set({ pointIds, anchorIds, segmentIds });
  }

  add(item: Selectable): void {
    const state = this.#state.peek();
    switch (item.kind) {
      case "point": {
        const pointIds = new Set(state.pointIds);
        pointIds.add(item.id);
        this.#state.set({ ...state, pointIds });
        break;
      }
      case "anchor": {
        const anchorIds = new Set(state.anchorIds);
        anchorIds.add(item.id);
        this.#state.set({ ...state, anchorIds });
        break;
      }
      case "segment": {
        const segmentIds = new Set(state.segmentIds);
        segmentIds.add(item.id);
        this.#state.set({ ...state, segmentIds });
        break;
      }
    }
  }

  remove(item: Selectable): void {
    const state = this.#state.peek();
    switch (item.kind) {
      case "point": {
        const pointIds = new Set(state.pointIds);
        pointIds.delete(item.id);
        this.#state.set({ ...state, pointIds });
        break;
      }
      case "anchor": {
        const anchorIds = new Set(state.anchorIds);
        anchorIds.delete(item.id);
        this.#state.set({ ...state, anchorIds });
        break;
      }
      case "segment": {
        const segmentIds = new Set(state.segmentIds);
        segmentIds.delete(item.id);
        this.#state.set({ ...state, segmentIds });
        break;
      }
    }
  }

  toggle(item: Selectable): void {
    if (this.isSelected(item)) {
      this.remove(item);
    } else {
      this.add(item);
    }
  }

  clear(): void {
    this.#state.set(emptySelectionState());
  }
}
