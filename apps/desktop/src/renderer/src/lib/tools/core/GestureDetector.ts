import type { Point2D } from "@shift/types";

export type ToolKey = "Escape" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Backspace";

export type ToolEvent =
  | { type: "pointerMove"; point: Point2D }
  | { type: "click"; point: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "doubleClick"; point: Point2D }
  | {
      type: "dragStart";
      point: Point2D;
      screenPoint: Point2D;
      shiftKey: boolean;
      altKey: boolean;
    }
  | {
      type: "drag";
      point: Point2D;
      screenPoint: Point2D;
      origin: Point2D;
      screenOrigin: Point2D;
      delta: Point2D;
      screenDelta: Point2D;
      shiftKey: boolean;
      altKey: boolean;
    }
  | {
      type: "dragEnd";
      point: Point2D;
      screenPoint: Point2D;
      origin: Point2D;
      screenOrigin: Point2D;
    }
  | { type: "dragCancel" }
  | {
      type: "keyDown";
      key: ToolKey | (string & {});
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  | { type: "keyUp"; key: ToolKey | (string & {}) }
  | { type: "selectionChanged" };

export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

export interface GestureDetectorConfig {
  dragThreshold?: number;
  doubleClickTime?: number;
  doubleClickDistance?: number;
}

const DEFAULT_CONFIG: Required<GestureDetectorConfig> = {
  dragThreshold: 3,
  doubleClickTime: 300,
  doubleClickDistance: 5,
};

export class GestureDetector {
  private downPoint: Point2D | null = null;
  private downScreenPoint: Point2D | null = null;
  private downModifiers: Modifiers | null = null;
  private dragging = false;
  private lastClickTime = 0;
  private lastClickPoint: Point2D | null = null;

  readonly dragThreshold: number;
  readonly doubleClickTime: number;
  readonly doubleClickDistance: number;

  constructor(config: GestureDetectorConfig = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.dragThreshold = merged.dragThreshold;
    this.doubleClickTime = merged.doubleClickTime;
    this.doubleClickDistance = merged.doubleClickDistance;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  pointerDown(point: Point2D, screenPoint: Point2D, modifiers: Modifiers): void {
    this.downPoint = point;
    this.downScreenPoint = screenPoint;
    this.downModifiers = modifiers;
    this.dragging = false;
  }

  pointerMove(point: Point2D, screenPoint: Point2D, modifiers: Modifiers): ToolEvent[] {
    if (!this.downPoint || !this.downScreenPoint || !this.downModifiers) {
      return [{ type: "pointerMove", point }];
    }

    const distance = Math.hypot(
      screenPoint.x - this.downScreenPoint.x,
      screenPoint.y - this.downScreenPoint.y,
    );

    if (!this.dragging && distance > this.dragThreshold) {
      this.dragging = true;
      return [
        {
          type: "dragStart",
          point: this.downPoint,
          screenPoint: this.downScreenPoint,
          shiftKey: this.downModifiers.shiftKey,
          altKey: this.downModifiers.altKey,
        },
      ];
    }

    if (this.dragging) {
      return [
        {
          type: "drag",
          point,
          screenPoint,
          origin: this.downPoint,
          screenOrigin: this.downScreenPoint,
          delta: {
            x: point.x - this.downPoint.x,
            y: point.y - this.downPoint.y,
          },
          screenDelta: {
            x: screenPoint.x - this.downScreenPoint.x,
            y: screenPoint.y - this.downScreenPoint.y,
          },
          shiftKey: modifiers.shiftKey,
          altKey: modifiers.altKey,
        },
      ];
    }

    return [];
  }

  pointerUp(point: Point2D, screenPoint: Point2D): ToolEvent[] {
    if (!this.downPoint || !this.downScreenPoint || !this.downModifiers) return [];

    const events: ToolEvent[] = [];

    if (this.dragging) {
      events.push({
        type: "dragEnd",
        point,
        screenPoint,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
      });
    } else {
      const now = Date.now();
      const timeSinceLastClick = now - this.lastClickTime;
      const distFromLastClick = this.lastClickPoint
        ? Math.hypot(point.x - this.lastClickPoint.x, point.y - this.lastClickPoint.y)
        : Infinity;

      if (
        timeSinceLastClick < this.doubleClickTime &&
        distFromLastClick < this.doubleClickDistance
      ) {
        events.push({ type: "doubleClick", point });
        this.lastClickTime = 0;
        this.lastClickPoint = null;
      } else {
        events.push({
          type: "click",
          point,
          shiftKey: this.downModifiers.shiftKey,
          altKey: this.downModifiers.altKey,
        });
        this.lastClickTime = now;
        this.lastClickPoint = point;
      }
    }

    this.resetPointerState();
    return events;
  }

  reset(): void {
    this.resetPointerState();
    this.lastClickTime = 0;
    this.lastClickPoint = null;
  }

  private resetPointerState(): void {
    this.downPoint = null;
    this.downScreenPoint = null;
    this.downModifiers = null;
    this.dragging = false;
  }
}
