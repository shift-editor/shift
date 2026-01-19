import type { PointId } from "@/types/ids";
import type { SegmentIndicator } from "@/types/indicator";
import { signal, type WritableSignal } from "../reactive/signal";

export interface IndicatorManager {
  readonly hoveredPoint: PointId | null;
  readonly hoveredSegment: SegmentIndicator | null;

  setHoveredPoint(pointId: PointId | null): void;
  setHoveredSegment(indicator: SegmentIndicator | null): void;
  clearAll(): void;
}

export function createIndicatorManager(): IndicatorManager {
  const hoveredPoint: WritableSignal<PointId | null> = signal(null);
  const hoveredSegment: WritableSignal<SegmentIndicator | null> = signal(null);

  return {
    get hoveredPoint(): PointId | null {
      return hoveredPoint.value;
    },

    get hoveredSegment(): SegmentIndicator | null {
      return hoveredSegment.value;
    },

    setHoveredPoint(pointId: PointId | null): void {
      hoveredPoint.value = pointId;
      if (pointId !== null) {
        hoveredSegment.value = null;
      }
    },

    setHoveredSegment(indicator: SegmentIndicator | null): void {
      hoveredSegment.value = indicator;
      if (indicator !== null) {
        hoveredPoint.value = null;
      }
    },

    clearAll(): void {
      hoveredPoint.value = null;
      hoveredSegment.value = null;
    },
  };
}
