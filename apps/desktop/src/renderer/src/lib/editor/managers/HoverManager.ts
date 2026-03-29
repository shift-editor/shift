import { signal, type WritableSignal, type Signal } from "../../reactive/signal";
import type { PointId, AnchorId } from "@shift/types";
import { asPointId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { VisualState } from "@/types/editor";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { HoverResult } from "@/types/hitResult";

export class HoverManager {
  private $hoveredPointId: WritableSignal<PointId | null>;
  private $hoveredAnchorId: WritableSignal<AnchorId | null>;
  private $hoveredSegmentId: WritableSignal<SegmentIndicator | null>;
  private $hoveredBoundingBoxHandle: WritableSignal<BoundingBoxHitResult>;
  #hoveredSegmentPointIds: ReadonlySet<PointId> = new Set();

  constructor() {
    this.$hoveredPointId = signal<PointId | null>(null);
    this.$hoveredAnchorId = signal<AnchorId | null>(null);
    this.$hoveredSegmentId = signal<SegmentIndicator | null>(null);
    this.$hoveredBoundingBoxHandle = signal<BoundingBoxHitResult>(null);
  }

  get hoveredPointId(): Signal<PointId | null> {
    return this.$hoveredPointId;
  }

  get hoveredSegmentId(): Signal<SegmentIndicator | null> {
    return this.$hoveredSegmentId;
  }

  get hoveredAnchorId(): Signal<AnchorId | null> {
    return this.$hoveredAnchorId;
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
      this.$hoveredAnchorId.set(null);
      this.$hoveredSegmentId.set(null);
      this.#hoveredSegmentPointIds = new Set();
    }
  }

  setHoveredAnchor(anchorId: AnchorId | null): void {
    this.$hoveredAnchorId.set(anchorId);
    if (anchorId !== null) {
      this.$hoveredPointId.set(null);
      this.$hoveredSegmentId.set(null);
      this.#hoveredSegmentPointIds = new Set();
    }
  }

  setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.$hoveredSegmentId.set(indicator);
    this.#hoveredSegmentPointIds =
      indicator === null ? new Set() : this.#getPointIdsFromSegmentId(indicator.segmentId);
    if (indicator !== null) {
      this.$hoveredPointId.set(null);
    }
  }

  applyHoverResult(result: HoverResult): void {
    switch (result.type) {
      case "boundingBox":
        this.$hoveredBoundingBoxHandle.set(result.handle);
        this.$hoveredPointId.set(null);
        this.$hoveredAnchorId.set(null);
        this.$hoveredSegmentId.set(null);
        break;
      case "anchor":
        this.$hoveredBoundingBoxHandle.set(null);
        this.setHoveredAnchor(result.anchorId);
        break;
      case "point":
        this.$hoveredBoundingBoxHandle.set(null);
        this.setHoveredPoint(result.pointId);
        break;
      case "segment":
        this.$hoveredBoundingBoxHandle.set(null);
        this.setHoveredSegment({
          segmentId: result.segmentId,
          closestPoint: result.closestPoint,
          t: result.t,
        });
        break;
      case "none":
        this.clearHover();
        break;
    }
  }

  clearHover(): void {
    this.$hoveredPointId.set(null);
    this.$hoveredAnchorId.set(null);
    this.$hoveredSegmentId.set(null);
    this.$hoveredBoundingBoxHandle.set(null);
    this.#hoveredSegmentPointIds = new Set();
  }

  getPointVisualState(pointId: PointId, isPointSelected: (id: PointId) => boolean): VisualState {
    if (isPointSelected(pointId)) {
      return "selected";
    }
    if (this.$hoveredPointId.peek() === pointId) {
      return "hovered";
    }

    if (this.#hoveredSegmentPointIds.has(pointId)) {
      return "hovered";
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
    if (this.$hoveredSegmentId.peek()?.segmentId === segmentId) {
      return "hovered";
    }
    return "idle";
  }

  #getPointIdsFromSegmentId(segmentId: SegmentId): Set<PointId> {
    const [id1, id2] = segmentId.split(":");
    if (!id1 || !id2) {
      return new Set<PointId>();
    }
    return new Set([asPointId(id1), asPointId(id2)]);
  }
}
