import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Point2D } from "@shift/geo";

/** Edge slot the floating toolbar docks to. */
export type ToolbarDock = "bottom" | "top" | "left" | "right";

/**
 * How the bar sits in its slot.
 *
 * `flat` is the horizontal bar on the top and bottom edges, with the handle at
 * its right end. `stand` is that bar turned a quarter clockwise about its
 * handle, so the handle ends up at the bottom; it is used on the left and right
 * edges. The handle is the pivot, so the bar only ever swings between 9 and 12
 * o'clock.
 */
export type ToolbarPose = "flat" | "stand";

/** Size of the canvas panel the toolbar floats over. */
export interface ToolbarFrame {
  width: number;
  height: number;
}

/** Measured sizes the toolbar's placement depends on. */
export interface ToolbarMetrics {
  frame: ToolbarFrame;
  /** Bar length along its tools, the same in both poses. */
  barLength: number;
}

/** What the user is holding while the bar is dragged by its handle. */
export interface ToolbarDragState {
  /** Pointer position in canvas panel coordinates. */
  pointer: Point2D;
  /** Handle centre of the carried bar: follows the pointer, kept inside the frame. */
  handle: Point2D;
  /** Offset from the carried bar's top-left corner to its handle, in the pose it was picked up in. */
  handleInBar: Point2D;
  /** Offset from the pointer to the handle where it was grabbed, so the bar does not jump on detach. */
  grab: Point2D;
  /** Slot the bar was picked up from; the carried bar keeps that slot's pose. */
  seatDock: ToolbarDock;
  /** Edge the carried bar is steering toward: the slot it lands in if released now. */
  target: ToolbarDock;
  /** Bar length along its tools. */
  length: number;
  frame: ToolbarFrame;
  /**
   * Where the pointer went down while the bar is still held in its starting slot.
   * Null once the pointer has pulled the bar loose.
   */
  tether: Point2D | null;
}

/** Everything needed to begin a drag. */
export interface ToolbarDragStart {
  dock: ToolbarDock;
  length: number;
  /** Pointer position when the drag begins. */
  pointer: Point2D;
  /** Handle centre when the drag begins. */
  handle: Point2D;
  /** Offset from the bar's top-left corner to its handle. */
  handleInBar: Point2D;
  frame: ToolbarFrame;
}

/**
 * How far the bar is raised off the canvas.
 *
 * `rest` is docked. `lifted` is carried by its handle.
 */
export type ToolbarLift = "rest" | "lifted";

/** Where the bar's handle sat the last time it was laid out. */
export interface ToolbarBarPlace {
  key: string;
  pose: ToolbarPose;
  handle: Point2D;
}

/** Motion of a running slide and turn, read from the rendered bar. */
export interface ToolbarBarMotion {
  translate: Point2D;
  rotateDeg: number;
}

/** One keyframe of the tools' dip, with `offset` as a fraction of the turn's duration. */
export type ToolDipKeyframe = { opacity: number; offset: number };

export interface UseToolbarDragOptions {
  /** The overlay the toolbar floats in; its box is the frame the bar docks against. */
  layerRef: RefObject<HTMLDivElement | null>;
  dock: ToolbarDock;
  onDock: (dock: ToolbarDock) => void;
}

export interface ToolbarDragControls {
  /** The drag in progress, or null while the bar is docked. */
  drag: ToolbarDragState | null;
  onGripPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}
