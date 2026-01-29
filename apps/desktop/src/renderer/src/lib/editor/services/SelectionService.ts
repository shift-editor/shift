import type { PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";
import type { SelectionManager } from "../managers";

export class SelectionService {
  #manager: SelectionManager;

  constructor(manager: SelectionManager) {
    this.#manager = manager;
  }

  getSelectedPoints(): readonly PointId[] {
    return [...this.#manager.selectedPointIds.value];
  }

  getSelectedSegments(): readonly SegmentId[] {
    return [...this.#manager.selectedSegmentIds.value];
  }

  getSelectedPointsCount(): number {
    return this.#manager.selectedPointIds.value.size;
  }

  getSelectedSegmentsCount(): number {
    return this.#manager.selectedSegmentIds.value.size;
  }

  getMode(): SelectionMode {
    return this.#manager.selectionMode.value;
  }

  selectPoints(ids: readonly PointId[]): void {
    this.#manager.selectPoints(new Set(ids));
  }

  addPoint(id: PointId): void {
    this.#manager.addPointToSelection(id);
  }

  removePoint(id: PointId): void {
    this.#manager.removePointFromSelection(id);
  }

  togglePoint(id: PointId): void {
    this.#manager.togglePointSelection(id);
  }

  isPointSelected(id: PointId): boolean {
    return this.#manager.isPointSelected(id);
  }

  selectSegments(ids: readonly SegmentId[]): void {
    this.#manager.selectSegments(new Set(ids));
  }

  addSegment(id: SegmentId): void {
    this.#manager.addSegmentToSelection(id);
  }

  removeSegment(id: SegmentId): void {
    this.#manager.removeSegmentFromSelection(id);
  }

  toggleSegment(id: SegmentId): void {
    this.#manager.toggleSegmentInSelection(id);
  }

  isSegmentSelected(id: SegmentId): boolean {
    return this.#manager.isSegmentSelected(id);
  }

  clear(): void {
    this.#manager.clearSelection();
  }

  hasSelection(): boolean {
    return this.#manager.hasSelection();
  }

  setMode(mode: SelectionMode): void {
    this.#manager.setSelectionMode(mode);
  }
}
