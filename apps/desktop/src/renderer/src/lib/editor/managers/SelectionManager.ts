import { signal, type WritableSignal, type Signal } from "../../reactive/signal";
import type { PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";

export class SelectionManager {
  private $selectedPointIds: WritableSignal<ReadonlySet<PointId>>;
  private $selectedSegmentIds: WritableSignal<ReadonlySet<SegmentId>>;
  private $selectionMode: WritableSignal<SelectionMode>;

  constructor() {
    this.$selectedPointIds = signal<ReadonlySet<PointId>>(new Set());
    this.$selectedSegmentIds = signal<ReadonlySet<SegmentId>>(new Set());
    this.$selectionMode = signal<SelectionMode>("committed");
  }

  get selectedPointIds(): Signal<ReadonlySet<PointId>> {
    return this.$selectedPointIds;
  }

  get selectedSegmentIds(): Signal<ReadonlySet<SegmentId>> {
    return this.$selectedSegmentIds;
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
    this.$selectedSegmentIds.set(new Set());
  }

  hasSelection(): boolean {
    return this.$selectedPointIds.peek().size > 0 || this.$selectedSegmentIds.peek().size > 0;
  }

  setSelectionMode(mode: SelectionMode): void {
    this.$selectionMode.set(mode);
  }
}
