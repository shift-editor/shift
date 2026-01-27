import { signal, type WritableSignal, type Signal } from "../../reactive/signal";
import type { PointId } from "@shift/types";
import { asPointId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { VisualState } from "@/types/editor";
import type { BoundingBoxHitResult } from "@/types/boundingBox";

export class HoverManager {
  private $hoveredPointId: WritableSignal<PointId | null>;
  private $hoveredSegmentId: WritableSignal<SegmentIndicator | null>;
  private $hoveredBoundingBoxHandle: WritableSignal<BoundingBoxHitResult>;

  constructor() {
    this.$hoveredPointId = signal<PointId | null>(null);
    this.$hoveredSegmentId = signal<SegmentIndicator | null>(null);
    this.$hoveredBoundingBoxHandle = signal<BoundingBoxHitResult>(null);
  }

  get hoveredPointId(): Signal<PointId | null> {
    return this.$hoveredPointId;
  }

  get hoveredSegmentId(): Signal<SegmentIndicator | null> {
    return this.$hoveredSegmentId;
  }

  get hoveredBoundingBoxHandle(): Signal<BoundingBoxHitResult> {
    return this.$hoveredBoundingBoxHandle;
  }

  setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void {
    this.$hoveredBoundingBoxHandle.set(handle);
  }

  getHoveredBoundingBoxHandle(): BoundingBoxHitResult {
    return this.$hoveredBoundingBoxHandle.peek();
  }

  setHoveredPoint(pointId: PointId | null): void {
    this.$hoveredPointId.set(pointId);
    if (pointId !== null) {
      this.$hoveredSegmentId.set(null);
    }
  }

  setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.$hoveredSegmentId.set(indicator);
    if (indicator !== null) {
      this.$hoveredPointId.set(null);
    }
  }

  clearHover(): void {
    this.$hoveredPointId.set(null);
    this.$hoveredSegmentId.set(null);
    this.$hoveredBoundingBoxHandle.set(null);
  }

  getPointVisualState(pointId: PointId, isPointSelected: (id: PointId) => boolean): VisualState {
    if (isPointSelected(pointId)) {
      return "selected";
    }
    if (this.$hoveredPointId.value === pointId) {
      return "hovered";
    }

    const hoveredSegment = this.$hoveredSegmentId.value;
    if (hoveredSegment) {
      const segmentPointIds = this.#getPointIdsFromSegmentId(hoveredSegment.segmentId);
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
    if (this.$hoveredSegmentId.value?.segmentId === segmentId) {
      return "hovered";
    }
    return "idle";
  }

  #getPointIdsFromSegmentId(segmentId: SegmentId): Set<PointId> {
    const [id1, id2] = segmentId.split(":");
    return new Set([asPointId(id1), asPointId(id2)]);
  }
}
