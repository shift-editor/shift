import { signal, type WritableSignal } from "../reactive/signal";
import type { PointId } from "@shift/types";
import { asPointId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { VisualState } from "@/types/editor";

export class HoverManager {
  #hoveredPointId: WritableSignal<PointId | null>;
  #hoveredSegmentId: WritableSignal<SegmentIndicator | null>;

  constructor() {
    this.#hoveredPointId = signal<PointId | null>(null);
    this.#hoveredSegmentId = signal<SegmentIndicator | null>(null);
  }

  get hoveredPointId(): PointId | null {
    return this.#hoveredPointId.value;
  }

  get hoveredSegmentId(): SegmentIndicator | null {
    return this.#hoveredSegmentId.value;
  }

  get hoveredPointIdSignal(): WritableSignal<PointId | null> {
    return this.#hoveredPointId;
  }

  get hoveredSegmentIdSignal(): WritableSignal<SegmentIndicator | null> {
    return this.#hoveredSegmentId;
  }

  setHoveredPoint(pointId: PointId | null): void {
    this.#hoveredPointId.set(pointId);
    if (pointId !== null) {
      this.#hoveredSegmentId.set(null);
    }
  }

  setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#hoveredSegmentId.set(indicator);
    if (indicator !== null) {
      this.#hoveredPointId.set(null);
    }
  }

  clearHover(): void {
    this.#hoveredPointId.set(null);
    this.#hoveredSegmentId.set(null);
  }

  getPointVisualState(
    pointId: PointId,
    isPointSelected: (id: PointId) => boolean,
  ): VisualState {
    if (isPointSelected(pointId)) {
      return "selected";
    }
    if (this.#hoveredPointId.value === pointId) {
      return "hovered";
    }

    const hoveredSegment = this.#hoveredSegmentId.value;
    if (hoveredSegment) {
      const segmentPointIds = this.#getPointIdsFromSegmentId(
        hoveredSegment.segmentId,
      );
      if (segmentPointIds.has(pointId)) {
        return "hovered";
      }
    }
    return "idle";
  }

  getSegmentVisualState(
    segmentId: SegmentId,
    isSegmentSelected: (id: SegmentId) => boolean,
  ): VisualState {
    if (isSegmentSelected(segmentId)) {
      return "selected";
    }
    if (this.#hoveredSegmentId.value?.segmentId === segmentId) {
      return "hovered";
    }
    return "idle";
  }

  #getPointIdsFromSegmentId(segmentId: SegmentId): Set<PointId> {
    const [id1, id2] = segmentId.split(":");
    return new Set([asPointId(id1), asPointId(id2)]);
  }
}
