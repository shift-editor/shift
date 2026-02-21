import type { Point2D } from "@shift/types";
import type { ToolEvent } from "@/lib/tools/core/GestureDetector";
import { makeTestCoordinates } from "./coordinates";

export interface ToolMouseEvent {
  readonly screen: Point2D;
  readonly upm: Point2D;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly button: number;
}

export function createToolMouseEvent(
  x: number,
  y: number,
  options?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    button?: number;
  },
): ToolMouseEvent {
  return {
    screen: { x, y },
    upm: { x, y },
    shiftKey: options?.shiftKey ?? false,
    ctrlKey: options?.ctrlKey ?? false,
    metaKey: options?.metaKey ?? false,
    altKey: options?.altKey ?? false,
    button: options?.button ?? 0,
  };
}

export interface ToolEventTarget {
  handleEvent(event: ToolEvent): void;
  activate?(): void;
  deactivate?(): void;
}

export class ToolEventSimulator {
  private mouseDown = false;
  private downPoint: Point2D | null = null;
  private downScreenPoint: Point2D | null = null;

  constructor(private tool: ToolEventTarget) {}

  setReady(): void {
    this.tool.activate?.();
  }

  setIdle(): void {
    this.tool.deactivate?.();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.mouseDown = true;
    this.downPoint = event.upm;
    this.downScreenPoint = event.screen;
    const coords = makeTestCoordinates(event.upm);
    this.tool.handleEvent({
      type: "dragStart",
      point: event.upm,
      coords,
      screenPoint: event.screen,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  }

  onMouseMove(event: ToolMouseEvent): void {
    const coords = makeTestCoordinates(event.upm);
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "drag",
        point: event.upm,
        coords,
        screenPoint: event.screen,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
        delta: {
          x: event.upm.x - this.downPoint.x,
          y: event.upm.y - this.downPoint.y,
        },
        screenDelta: {
          x: event.screen.x - this.downScreenPoint.x,
          y: event.screen.y - this.downScreenPoint.y,
        },
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
    } else {
      this.tool.handleEvent({
        type: "pointerMove",
        point: event.upm,
        coords,
      });
    }
  }

  onMouseUp(event: ToolMouseEvent): void {
    const coords = makeTestCoordinates(event.upm);
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "dragEnd",
        point: event.upm,
        coords,
        screenPoint: event.screen,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
      });
    }
    this.mouseDown = false;
    this.downPoint = null;
    this.downScreenPoint = null;
  }

  click(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): void {
    const point = { x, y };
    const coords = makeTestCoordinates(point);
    this.tool.handleEvent({
      type: "click",
      point,
      coords,
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
    });
  }

  doubleClick(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): void {
    const point = { x, y };
    const coords = makeTestCoordinates(point);
    this.tool.handleEvent({
      type: "doubleClick",
      point,
      coords,
      ...options,
    });
  }

  cancel(): void {
    this.tool.handleEvent({
      type: "keyDown",
      key: "Escape",
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  }

  keyDown(
    key: string,
    options?: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean },
  ): void {
    this.tool.handleEvent({
      type: "keyDown",
      key,
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: options?.metaKey ?? false,
    });
  }
}
