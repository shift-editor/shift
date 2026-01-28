import type { PointId } from "@shift/types";
import type { SegmentIndicator } from "@/types/indicator";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { HoverManager } from "../managers";

export class HoverService {
  #manager: HoverManager;

  constructor(manager: HoverManager) {
    this.#manager = manager;
  }

  getHoveredPoint(): PointId | null {
    return this.#manager.hoveredPointId.value;
  }

  getHoveredSegment(): SegmentIndicator | null {
    return this.#manager.hoveredSegmentId.value;
  }

  getHoveredBoundingBoxHandle(): BoundingBoxHitResult {
    return this.#manager.getHoveredBoundingBoxHandle();
  }

  setHoveredPoint(id: PointId | null): void {
    this.#manager.setHoveredPoint(id);
  }

  setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#manager.setHoveredSegment(indicator);
  }

  setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void {
    this.#manager.setHoveredBoundingBoxHandle(handle);
  }

  clearAll(): void {
    this.#manager.clearHover();
  }
}
