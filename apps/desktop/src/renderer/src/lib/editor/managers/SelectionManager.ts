import { signal, type WritableSignal, type Signal } from "../../reactive/signal";
import type { PointId, AnchorId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";

/**
 * Point-level and segment-level selection state.
 *
 * Selection operates in two modes: "committed" (user-confirmed) and "preview"
 * (transient marquee highlight that has not been finalized). There is no
 * contour-level selection; contours are implicitly selected when all their
 * points are selected.
 */
export class SelectionManager {
  private $selectedPointIds: WritableSignal<ReadonlySet<PointId>>;
  private $selectedAnchorIds: WritableSignal<ReadonlySet<AnchorId>>;
  private $selectedSegmentIds: WritableSignal<ReadonlySet<SegmentId>>;
  private $selectionMode: WritableSignal<SelectionMode>;

  constructor() {
    this.$selectedPointIds = signal<ReadonlySet<PointId>>(new Set());
    this.$selectedAnchorIds = signal<ReadonlySet<AnchorId>>(new Set());
    this.$selectedSegmentIds = signal<ReadonlySet<SegmentId>>(new Set());
    this.$selectionMode = signal<SelectionMode>("committed");
  }

  get selectedPointIds(): Signal<ReadonlySet<PointId>> {
    return this.$selectedPointIds;
  }

  get selectedSegmentIds(): Signal<ReadonlySet<SegmentId>> {
    return this.$selectedSegmentIds;
  }

  get selectedAnchorIds(): Signal<ReadonlySet<AnchorId>> {
    return this.$selectedAnchorIds;
  }

  get selectionMode(): Signal<SelectionMode> {
    return this.$selectionMode;
  }

  selectPoints(pointIds: PointId[]): void {
    this.$selectedPointIds.set(new Set(pointIds));
  }

  addPointToSelection(pointId: PointId): void {
    const next = new Set(this.$selectedPointIds.peek());
    next.add(pointId);
    this.$selectedPointIds.set(next);
  }

  removePointFromSelection(pointId: PointId): void {
    const next = new Set(this.$selectedPointIds.peek());
    next.delete(pointId);
    this.$selectedPointIds.set(next);
  }

  togglePointSelection(pointId: PointId): void {
    const next = new Set(this.$selectedPointIds.peek());
    if (next.has(pointId)) {
      next.delete(pointId);
    } else {
      next.add(pointId);
    }
    this.$selectedPointIds.set(next);
  }

  isPointSelected(pointId: PointId): boolean {
    return this.$selectedPointIds.peek().has(pointId);
  }

  selectAnchors(anchorIds: AnchorId[]): void {
    this.$selectedAnchorIds.set(new Set(anchorIds));
  }

  addAnchorToSelection(anchorId: AnchorId): void {
    const next = new Set(this.$selectedAnchorIds.peek());
    next.add(anchorId);
    this.$selectedAnchorIds.set(next);
  }

  removeAnchorFromSelection(anchorId: AnchorId): void {
    const next = new Set(this.$selectedAnchorIds.peek());
    next.delete(anchorId);
    this.$selectedAnchorIds.set(next);
  }

  toggleAnchorSelection(anchorId: AnchorId): void {
    const next = new Set(this.$selectedAnchorIds.peek());
    if (next.has(anchorId)) {
      next.delete(anchorId);
    } else {
      next.add(anchorId);
    }
    this.$selectedAnchorIds.set(next);
  }

  isAnchorSelected(anchorId: AnchorId): boolean {
    return this.$selectedAnchorIds.peek().has(anchorId);
  }

  selectSegments(segmentIds: ReadonlySet<SegmentId>): void {
    this.$selectedSegmentIds.set(new Set(segmentIds));
  }

  addSegmentToSelection(segmentId: SegmentId): void {
    const next = new Set(this.$selectedSegmentIds.peek());
    next.add(segmentId);
    this.$selectedSegmentIds.set(next);
  }

  removeSegmentFromSelection(segmentId: SegmentId): void {
    const next = new Set(this.$selectedSegmentIds.peek());
    next.delete(segmentId);
    this.$selectedSegmentIds.set(next);
  }

  toggleSegmentInSelection(segmentId: SegmentId): void {
    const next = new Set(this.$selectedSegmentIds.peek());
    if (next.has(segmentId)) {
      next.delete(segmentId);
    } else {
      next.add(segmentId);
    }
    this.$selectedSegmentIds.set(next);
  }

  isSegmentSelected(segmentId: SegmentId): boolean {
    return this.$selectedSegmentIds.peek().has(segmentId);
  }

  clearSelection(): void {
    this.$selectedPointIds.set(new Set());
    this.$selectedAnchorIds.set(new Set());
    this.$selectedSegmentIds.set(new Set());
  }

  hasSelection(): boolean {
    return (
      this.$selectedPointIds.peek().size > 0 ||
      this.$selectedAnchorIds.peek().size > 0 ||
      this.$selectedSegmentIds.peek().size > 0
    );
  }

  setSelectionMode(mode: SelectionMode): void {
    this.$selectionMode.set(mode);
  }
}
