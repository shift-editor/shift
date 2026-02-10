/**
 * Gesture detection — converts raw pointer/keyboard input into semantic
 * {@link ToolEvent}s that drive the tool state machine.
 *
 * The {@link GestureDetector} tracks pointer-down state, applies a drag
 * threshold, detects double-clicks by timing, and emits a discriminated
 * union of events that tools consume without knowing about raw DOM events.
 *
 * @module
 */
import type { Point2D } from "@shift/types";

/** Well-known key names that tools handle directly. */
export type ToolKey = "Escape" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Backspace";

/**
 * Discriminated union of all events a tool can receive.
 *
 * Coordinates come in two flavors: `point` is in UPM space (used for glyph
 * editing), `screenPoint` is in screen pixels (used for drag thresholds and
 * panning). Drag events include cumulative `delta`/`screenDelta` from the
 * drag origin.
 */
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

/**
 * Modifier key state captured at the moment of a pointer or key event.
 * Space is tracked separately by ToolManager (not here) to trigger the
 * temporary Hand tool override.
 */
export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/**
 * Tuning parameters for gesture recognition.
 * All distances are in screen pixels; time is in milliseconds.
 */
export interface GestureDetectorConfig {
  /** Minimum screen-pixel distance before a pointer-down becomes a drag. */
  dragThreshold?: number;
  /** Maximum interval between clicks to count as a double-click. */
  doubleClickTime?: number;
  /** Maximum screen-pixel drift between clicks to count as a double-click. */
  doubleClickDistance?: number;
}

const DEFAULT_CONFIG: Required<GestureDetectorConfig> = {
  dragThreshold: 3,
  doubleClickTime: 300,
  doubleClickDistance: 5,
};

/**
 * Stateful gesture recognizer that sits between raw DOM events and the
 * tool state machine.
 *
 * Feed it `pointerDown`, `pointerMove`, and `pointerUp` calls; it returns
 * zero or more {@link ToolEvent}s. Internally it tracks drag state, applies
 * the drag threshold, and times double-clicks.
 */
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

  /**
   * Process a pointer move. Returns `pointerMove` if not pressed, `dragStart`
   * on threshold crossing, or `drag` while dragging.
   */
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

  /**
   * Process a pointer release. Returns `dragEnd` if dragging, `doubleClick`
   * if within timing/distance thresholds, or `click` otherwise.
   */
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
