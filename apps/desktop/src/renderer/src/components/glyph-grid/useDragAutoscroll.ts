import { useEffect, useRef } from "react";

/** How close to the container's top or bottom a drag starts scrolling it, in CSS pixels. */
const AUTOSCROLL_EDGE_PX = 12;
/** Scroll speed per pixel the pointer is past that edge, per frame, up to a maximum. */
const AUTOSCROLL_RATE = 0.4;
const AUTOSCROLL_MAX_PX = 16;

interface DragAutoscrollOptions {
  /** The scrolling element the drag happens in. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Called with the pointer in client pixels as it moves, and each frame the
   * container scrolls under a held pointer, then with the pointer held inside
   * the container's visible edge.
   */
  readonly onDrag: (clientX: number, clientY: number) => void;
}

/** A drag inside a scrolling container, started with {@link DragAutoscroll.start}. */
export interface DragAutoscroll {
  start(clientX: number, clientY: number): void;
  /** Follows the pointer; does nothing when no drag is under way. */
  move(clientX: number, clientY: number): void;
  end(): void;
}

/**
 * A drag that scrolls its container each frame while the pointer is held
 * past the top or bottom, so it can reach what is scrolled out of view.
 */
export function useDragAutoscroll({ containerRef, onDrag }: DragAutoscrollOptions): DragAutoscroll {
  // non-reactive: the dragging pointer in client pixels, for the autoscroll frame.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  // The autoscroll frame outlives renders, so it reads the latest callback through a ref.
  const latest = useRef(onDrag);
  latest.current = onDrag;

  const scroll = () => {
    const container = containerRef.current;
    const pointer = pointerRef.current;
    if (!container || !pointer) return;
    const bounds = container.getBoundingClientRect();
    const above = bounds.top + AUTOSCROLL_EDGE_PX - pointer.y;
    const below = pointer.y - (bounds.bottom - AUTOSCROLL_EDGE_PX);
    const reach = Math.max(above, below);
    if (reach > 0) {
      const speed = Math.min(reach * AUTOSCROLL_RATE, AUTOSCROLL_MAX_PX);
      container.scrollTop += above > 0 ? -speed : speed;
      const y = Math.min(Math.max(pointer.y, bounds.top + 1), bounds.bottom - 1);
      latest.current(pointer.x, y);
    }
    frameRef.current = requestAnimationFrame(scroll);
  };

  const end = () => {
    pointerRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  useEffect(() => end, []);

  return {
    start(clientX, clientY) {
      pointerRef.current = { x: clientX, y: clientY };
      frameRef.current = requestAnimationFrame(scroll);
    },
    move(clientX, clientY) {
      if (!pointerRef.current) return;
      pointerRef.current = { x: clientX, y: clientY };
      onDrag(clientX, clientY);
    },
    end,
  };
}
