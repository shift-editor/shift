/**
 * Gesture detection — converts raw pointer/keyboard input into semantic
 * {@link ToolEvent}s that drive the tool state machine.
 *
 * The {@link GestureDetector} tracks pointer-down state, applies a drag
 * threshold, detects double-clicks by timing, and emits a discriminated
 * union of events that tools consume without knowing about raw DOM events.
 *
 * Pointer events carry {@link Coordinates} so tools use `event.coords` for
 * hit-test and layout without converting at each call site.
 *
 * @module
 */
import { Vec2, type Point2D } from "@shift/geo";
import type { Coordinates } from "@/types/coordinates";
import type { PointerTarget } from "@/types/target";

/** Well-known key names that tools handle directly. */
export type ToolKey = "Escape" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Backspace";

/**
 * Discriminated union of all events a tool can receive.
 *
 * Pointer events include `coords` so tools use the captured event coordinate
 * snapshot for hit-test and layout. Drag events include `origin` and `delta`
 * with both screen and scene coordinates.
 */
export interface ModifierKeys {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly accelKey: boolean;
}

interface PointerGestureInfo extends ModifierKeys {
  readonly coords: Coordinates;
}

export interface PointerDelta {
  readonly screen: Point2D;
  readonly scene: Point2D;
}

type PointerMoveGestureEvent = PointerGestureInfo & {
  readonly type: "pointerMove";
};

type ClickGestureEvent = PointerGestureInfo & {
  readonly type: "click";
};

type DoubleClickGestureEvent = PointerGestureInfo & {
  readonly type: "doubleClick";
};

type DragStartGestureEvent = PointerGestureInfo & {
  readonly type: "dragStart";
  readonly origin: Coordinates;
  readonly delta: PointerDelta;
};

type DragGestureEvent = PointerGestureInfo & {
  readonly type: "drag";
  readonly origin: Coordinates;
  readonly delta: PointerDelta;
};

type DragEndGestureEvent = PointerGestureInfo & {
  readonly type: "dragEnd";
  readonly origin: Coordinates;
  readonly delta: PointerDelta;
};

export type DragCancelEvent = { type: "dragCancel" };

export type KeyDownEvent = ModifierKeys & {
  readonly type: "keyDown";
  readonly key: ToolKey | (string & {});
};

export type KeyUpEvent = ModifierKeys & {
  readonly type: "keyUp";
  readonly key: ToolKey | (string & {});
};

export type SelectionChangedEvent = { type: "selectionChanged" };

export type GestureEvent =
  | PointerMoveGestureEvent
  | ClickGestureEvent
  | DoubleClickGestureEvent
  | DragStartGestureEvent
  | DragGestureEvent
  | DragEndGestureEvent
  | DragCancelEvent
  | KeyDownEvent
  | KeyUpEvent
  | SelectionChangedEvent;

type WithTarget<TEvent extends PointerGestureInfo> = TEvent & {
  readonly target: PointerTarget;
};

export type PointerMoveEvent = WithTarget<PointerMoveGestureEvent>;
export type ClickEvent = WithTarget<ClickGestureEvent>;
export type DoubleClickEvent = WithTarget<DoubleClickGestureEvent>;
export type DragStartEvent = WithTarget<DragStartGestureEvent>;
export type DragEvent = WithTarget<DragGestureEvent>;
export type DragEndEvent = WithTarget<DragEndGestureEvent>;

export type ToolEvent =
  | PointerMoveEvent
  | ClickEvent
  | DoubleClickEvent
  | DragStartEvent
  | DragEvent
  | DragEndEvent
  | DragCancelEvent
  | KeyDownEvent
  | KeyUpEvent
  | SelectionChangedEvent;

/**
 * Modifier key state captured at the moment of a pointer or key event.
 * Space is tracked separately by ToolManager (not here) to trigger the
 * temporary Hand tool override.
 */
export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  accelKey?: boolean;
}

export function normalizeModifiers(modifiers: Modifiers): ModifierKeys {
  const metaKey = modifiers.metaKey ?? false;
  const ctrlKey = modifiers.ctrlKey ?? false;

  return {
    shiftKey: modifiers.shiftKey,
    altKey: modifiers.altKey,
    metaKey,
    ctrlKey,
    accelKey: modifiers.accelKey ?? (metaKey || ctrlKey),
  };
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
  private downCoords: Coordinates | null = null;
  private downModifiers: ModifierKeys | null = null;
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

  pointerDown(coords: Coordinates, modifiers: Modifiers): void {
    this.downCoords = coords;
    this.downModifiers = normalizeModifiers(modifiers);
    this.dragging = false;
  }

  /**
   * Process a pointer move. Returns `pointerMove` if not pressed, `dragStart`
   * on threshold crossing, or `drag` while dragging.
   */
  pointerMove(coords: Coordinates, modifiers: Modifiers): GestureEvent[] {
    const modifierKeys = normalizeModifiers(modifiers);

    if (!this.downCoords || !this.downModifiers) {
      return [{ type: "pointerMove", coords, ...modifierKeys }];
    }

    const distance = Math.hypot(
      coords.screen.x - this.downCoords.screen.x,
      coords.screen.y - this.downCoords.screen.y,
    );
    const delta = pointerDelta(coords, this.downCoords);

    if (!this.dragging && distance > this.dragThreshold) {
      this.dragging = true;
      return [
        {
          type: "dragStart",
          coords,
          origin: this.downCoords,
          delta,
          ...modifierKeys,
        },
      ];
    }

    if (this.dragging) {
      return [
        {
          type: "drag",
          coords,
          origin: this.downCoords,
          delta,
          ...modifierKeys,
        },
      ];
    }

    return [];
  }

  /**
   * Process a pointer release. Returns `dragEnd` if dragging, `doubleClick`
   * if within timing/distance thresholds, or `click` otherwise.
   */
  pointerUp(coords: Coordinates, modifiers: Modifiers): GestureEvent[] {
    if (!this.downCoords || !this.downModifiers) return [];

    const modifierKeys = normalizeModifiers(modifiers);
    const events: GestureEvent[] = [];
    const delta = pointerDelta(coords, this.downCoords);

    if (this.dragging) {
      events.push({
        type: "dragEnd",
        coords,
        origin: this.downCoords,
        delta,
        ...modifierKeys,
      });
    } else {
      const now = Date.now();
      const timeSinceLastClick = now - this.lastClickTime;
      const distFromLastClick = this.lastClickPoint
        ? Math.hypot(coords.scene.x - this.lastClickPoint.x, coords.scene.y - this.lastClickPoint.y)
        : Infinity;

      if (
        timeSinceLastClick < this.doubleClickTime &&
        distFromLastClick < this.doubleClickDistance
      ) {
        events.push({
          type: "doubleClick",
          coords,
          ...modifierKeys,
        });
        this.lastClickTime = 0;
        this.lastClickPoint = null;
      } else {
        events.push({
          type: "click",
          coords,
          ...modifierKeys,
        });
        this.lastClickTime = now;
        this.lastClickPoint = coords.scene;
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
    this.downCoords = null;
    this.downModifiers = null;
    this.dragging = false;
  }
}

function pointerDelta(coords: Coordinates, origin: Coordinates): PointerDelta {
  return {
    screen: Vec2.sub(coords.screen, origin.screen),
    scene: Vec2.sub(coords.scene, origin.scene),
  };
}
