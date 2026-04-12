import type { PointId, ContourId, AnchorId } from "@shift/types";
import type { SegmentId } from "./indicator";
import type { Glyph } from "@/lib/model/Glyph";
import type { SelectionMode } from "./editor";
import {
  signal,
  computed,
  type WritableSignal,
  type Signal,
  type ComputedSignal,
} from "@/lib/reactive/signal";
import { Glyphs } from "@shift/font";

/** Discriminated reference to any selectable entity. */
export type Selectable =
  | { kind: "point"; id: PointId }
  | { kind: "anchor"; id: AnchorId }
  | { kind: "segment"; id: SegmentId };

/** Derived contour-aware queries, rebuilt when selection or glyph changes. */
interface DerivedSelection {
  readonly contourIds: ReadonlySet<ContourId>;
  readonly fullySelectedContourIds: ReadonlySet<ContourId>;
  readonly pointToContour: ReadonlyMap<PointId, ContourId>;
  readonly contourToPoints: ReadonlyMap<ContourId, readonly PointId[]>;
}

const EMPTY_DERIVED: DerivedSelection = {
  contourIds: new Set(),
  fullySelectedContourIds: new Set(),
  pointToContour: new Map(),
  contourToPoints: new Map(),
};

/**
 * Unified selection state with computed contour queries.
 *
 * Owns writable signals for point/anchor/segment selection. Getters
 * auto-unwrap signals — reading inside a computed/effect auto-tracks.
 *
 * Mutations use {@link Selectable} discriminated unions:
 * `selection.add({ kind: "point", id })`, `selection.toggle(...)`, etc.
 */
export class Selection {
  readonly #$pointIds: WritableSignal<ReadonlySet<PointId>>;
  readonly #$anchorIds: WritableSignal<ReadonlySet<AnchorId>>;
  readonly #$segmentIds: WritableSignal<ReadonlySet<SegmentId>>;
  readonly #$mode: WritableSignal<SelectionMode>;
  readonly #$derived: ComputedSignal<DerivedSelection>;

  constructor(glyph: Signal<Glyph | null>) {
    this.#$pointIds = signal<ReadonlySet<PointId>>(new Set());
    this.#$anchorIds = signal<ReadonlySet<AnchorId>>(new Set());
    this.#$segmentIds = signal<ReadonlySet<SegmentId>>(new Set());
    this.#$mode = signal<SelectionMode>("committed");

    this.#$derived = computed(() => {
      const pointIds = this.#$pointIds.value;
      const g = glyph.value;

      if (pointIds.size === 0 || !g) return EMPTY_DERIVED;

      const pointToContour = new Map<PointId, ContourId>();
      const contourToPoints = new Map<ContourId, PointId[]>();
      const contourIds = new Set<ContourId>();
      const contourTotalCounts = new Map<ContourId, number>();

      for (const { point, contour } of Glyphs.points(g)) {
        pointToContour.set(point.id, contour.id);
        contourTotalCounts.set(contour.id, (contourTotalCounts.get(contour.id) ?? 0) + 1);

        if (pointIds.has(point.id)) {
          contourIds.add(contour.id);
          const list = contourToPoints.get(contour.id);
          if (list) {
            list.push(point.id);
          } else {
            contourToPoints.set(contour.id, [point.id]);
          }
        }
      }

      const fullySelectedContourIds = new Set<ContourId>();
      for (const [cid, selected] of contourToPoints) {
        if (selected.length === contourTotalCounts.get(cid)) {
          fullySelectedContourIds.add(cid);
        }
      }

      return { contourIds, fullySelectedContourIds, pointToContour, contourToPoints };
    });
  }

  get pointIds(): ReadonlySet<PointId> {
    return this.#$pointIds.value;
  }

  get anchorIds(): ReadonlySet<AnchorId> {
    return this.#$anchorIds.value;
  }

  get segmentIds(): ReadonlySet<SegmentId> {
    return this.#$segmentIds.value;
  }

  get mode(): SelectionMode {
    return this.#$mode.value;
  }

  /** @knipclassignore — used by BooleanOps and upcoming callers */
  get contourIds(): ReadonlySet<ContourId> {
    return this.#$derived.value.contourIds;
  }

  /** @knipclassignore */
  get fullySelectedContourIds(): ReadonlySet<ContourId> {
    return this.#$derived.value.fullySelectedContourIds;
  }

  /** @knipclassignore — convenience for callers that need PointId[] */
  get points(): PointId[] {
    return [...this.#$pointIds.value];
  }

  /** @knipclassignore */
  get anchors(): AnchorId[] {
    return [...this.#$anchorIds.value];
  }

  /** @knipclassignore */
  get segments(): SegmentId[] {
    return [...this.#$segmentIds.value];
  }

  get hasPoints(): boolean {
    return this.#$pointIds.value.size > 0;
  }

  get hasAnchors(): boolean {
    return this.#$anchorIds.value.size > 0;
  }

  get hasSegments(): boolean {
    return this.#$segmentIds.value.size > 0;
  }

  get isEmpty(): boolean {
    return !this.hasPoints && !this.hasAnchors && !this.hasSegments;
  }

  /** @knipclassignore */
  get contourCount(): number {
    return this.#$derived.value.contourIds.size;
  }

  /** Raw signals for React hooks that need Signal<T>. */
  get $pointIds(): Signal<ReadonlySet<PointId>> {
    return this.#$pointIds;
  }

  /** @knipclassignore — used by React components */
  get $anchorIds(): Signal<ReadonlySet<AnchorId>> {
    return this.#$anchorIds;
  }

  get $segmentIds(): Signal<ReadonlySet<SegmentId>> {
    return this.#$segmentIds;
  }

  get $mode(): Signal<SelectionMode> {
    return this.#$mode;
  }

  /** @knipclassignore — used by clipboard and upcoming callers */
  pointsIn(contourId: ContourId): readonly PointId[] {
    return this.#$derived.value.contourToPoints.get(contourId) ?? [];
  }

  /** @knipclassignore */
  contourOf(pointId: PointId): ContourId | null {
    return this.#$derived.value.pointToContour.get(pointId) ?? null;
  }

  isSelected(item: Selectable): boolean {
    switch (item.kind) {
      case "point":
        return this.#$pointIds.peek().has(item.id);
      case "anchor":
        return this.#$anchorIds.peek().has(item.id);
      case "segment":
        return this.#$segmentIds.peek().has(item.id);
    }
  }

  hasSelection(): boolean {
    return !this.isEmpty;
  }

  /** Replace entire selection with the given items. Clears everything first. */
  select(items: readonly Selectable[]): void {
    const points = new Set<PointId>();
    const anchors = new Set<AnchorId>();
    const segments = new Set<SegmentId>();

    for (const item of items) {
      switch (item.kind) {
        case "point":
          points.add(item.id);
          break;
        case "anchor":
          anchors.add(item.id);
          break;
        case "segment":
          segments.add(item.id);
          break;
      }
    }

    this.#$pointIds.set(points);
    this.#$anchorIds.set(anchors);
    this.#$segmentIds.set(segments);
  }

  add(item: Selectable): void {
    switch (item.kind) {
      case "point": {
        const next = new Set(this.#$pointIds.peek());
        next.add(item.id);
        this.#$pointIds.set(next);
        break;
      }
      case "anchor": {
        const next = new Set(this.#$anchorIds.peek());
        next.add(item.id);
        this.#$anchorIds.set(next);
        break;
      }
      case "segment": {
        const next = new Set(this.#$segmentIds.peek());
        next.add(item.id);
        this.#$segmentIds.set(next);
        break;
      }
    }
  }

  remove(item: Selectable): void {
    switch (item.kind) {
      case "point": {
        const next = new Set(this.#$pointIds.peek());
        next.delete(item.id);
        this.#$pointIds.set(next);
        break;
      }
      case "anchor": {
        const next = new Set(this.#$anchorIds.peek());
        next.delete(item.id);
        this.#$anchorIds.set(next);
        break;
      }
      case "segment": {
        const next = new Set(this.#$segmentIds.peek());
        next.delete(item.id);
        this.#$segmentIds.set(next);
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

  setMode(mode: SelectionMode): void {
    this.#$mode.set(mode);
  }

  clear(): void {
    this.#$pointIds.set(new Set());
    this.#$anchorIds.set(new Set());
    this.#$segmentIds.set(new Set());
  }
}
