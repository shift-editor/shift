/**
 * Event helpers for testing.
 *
 * Provides utilities for creating mock mouse and keyboard events
 * for testing tool interactions.
 */

import { vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// MOUSE EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock React mouse event.
 *
 * @example
 * ```typescript
 * const event = createMouseEvent('mousedown', { clientX: 100, clientY: 200 });
 * tool.onMouseDown(event);
 * ```
 */
export function createMouseEvent(
  type: "mousedown" | "mouseup" | "mousemove" | "dblclick",
  options: {
    clientX: number;
    clientY: number;
    button?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }
): React.MouseEvent<HTMLCanvasElement> {
  return {
    type,
    clientX: options.clientX,
    clientY: options.clientY,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLCanvasElement>;
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock keyboard event.
 *
 * @example
 * ```typescript
 * const event = createKeyboardEvent('keydown', { key: 'Delete' });
 * tool.onKeyDown(event);
 * ```
 */
export function createKeyboardEvent(
  type: "keydown" | "keyup",
  options: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }
): KeyboardEvent {
  return {
    type,
    key: options.key,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulate a click at screen coordinates.
 * Returns the mouse events for further manipulation.
 *
 * @example
 * ```typescript
 * const { down, up } = simulateClick(100, 200);
 * tool.onMouseDown(down);
 * tool.onMouseUp(up);
 * ```
 */
export function simulateClick(x: number, y: number, options?: { shiftKey?: boolean }) {
  const down = createMouseEvent("mousedown", { clientX: x, clientY: y, ...options });
  const up = createMouseEvent("mouseup", { clientX: x, clientY: y, ...options });
  return { down, up };
}

/**
 * Simulate a drag from one point to another.
 * Returns all the mouse events for the drag operation.
 *
 * @example
 * ```typescript
 * const { down, moves, up } = simulateDrag(100, 100, 200, 200);
 * tool.onMouseDown(down);
 * moves.forEach(move => tool.onMouseMove(move));
 * tool.onMouseUp(up);
 * ```
 */
export function simulateDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps: number = 5
) {
  const down = createMouseEvent("mousedown", { clientX: fromX, clientY: fromY });

  const moves: React.MouseEvent<HTMLCanvasElement>[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    moves.push(createMouseEvent("mousemove", { clientX: x, clientY: y }));
  }

  const up = createMouseEvent("mouseup", { clientX: toX, clientY: toY });

  return { down, moves, up };
}
