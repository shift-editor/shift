import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Point2D } from "@shift/geo";
import type {
  ToolbarDragControls,
  ToolbarDragState,
  UseToolbarDragOptions,
} from "../types/toolbar";
import { isPress, nextToolbarDrag, releasedDock, startToolbarDrag } from "./toolbarDrag";
import { CanvasSurface } from "../lib/editor/rendering/CanvasSurface";
import { centreOf, frameOf } from "./toolbarGeometry";

/**
 * Where the handle sits inside the bar, from layout offsets.
 *
 * @remarks
 * Offsets ignore the transforms of a slide or turn still settling, so the bar
 * can be picked up mid-animation. The bar is unpositioned, so it and its handle
 * both measure from the same positioned wrapper.
 */
function handleInBar(grip: HTMLElement, bar: HTMLElement): Point2D {
  return {
    x: grip.offsetLeft - bar.offsetLeft + grip.offsetWidth / 2,
    y: grip.offsetTop - bar.offsetTop + grip.offsetHeight / 2,
  };
}

/** Drives dragging the toolbar by its handle: pointer tracking and where the bar lands on release. */
export function useToolbarDrag({
  layerRef,
  dock,
  onDock,
}: UseToolbarDragOptions): ToolbarDragControls {
  const [drag, setDrag] = useState<ToolbarDragState | null>(null);
  const dragRef = useRef<ToolbarDragState | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const lastPressAtRef = useRef(Number.NEGATIVE_INFINITY);
  const dragging = drag !== null;

  const publish = useCallback((next: ToolbarDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  // Track the drag on the window so it always ends, even when the pointer leaves
  // the handle, the window loses focus, or the browser cancels the gesture.
  useEffect(() => {
    if (!dragging) return;

    // A press covers the window to hold the grabbing cursor, so the second click of a
    // double-click lands on that cover; presses are paired here instead of by `dblclick`.
    const drop = () => {
      const current = dragRef.current;
      publish(null);
      if (!current) return;

      const now = performance.now();
      const landing = releasedDock(current, now - lastPressAtRef.current);
      const flipped = landing !== current.target;
      // A flip uses up both presses, so a third press starts a new pair.
      lastPressAtRef.current = isPress(current) && !flipped ? now : Number.NEGATIVE_INFINITY;
      onDock(landing);
    };
    const cancel = () => publish(null);
    const ownsEvent = (event: PointerEvent) => event.pointerId === pointerIdRef.current;
    const move = (event: PointerEvent) => {
      if (!ownsEvent(event)) return;

      // A release that never arrived, such as one lost to a context menu, ends the drag.
      if (event.buttons === 0) {
        drop();
        return;
      }

      const layer = layerRef.current;
      const previous = dragRef.current;
      if (!layer || !previous) return;

      const pointer = CanvasSurface.screenPoint(layer, { x: event.clientX, y: event.clientY });
      publish(nextToolbarDrag(previous, pointer, frameOf(layer.getBoundingClientRect())));
    };
    const release = (event: PointerEvent) => {
      if (ownsEvent(event)) drop();
    };
    const abort = (event: PointerEvent) => {
      if (ownsEvent(event)) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // Escape belongs to the drag while it is held, not to the tool underneath.
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("contextmenu", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("contextmenu", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [dragging, layerRef, onDock, publish]);

  const onGripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current;
    const bar = event.currentTarget.closest<HTMLElement>("[data-floating-toolbar]");
    // Ctrl+click opens the context menu on macOS, which would swallow the release.
    if (event.button !== 0 || event.ctrlKey || !layer || !bar) return;

    event.preventDefault();
    pointerIdRef.current = event.pointerId;

    publish(
      startToolbarDrag({
        dock,
        length: Math.max(bar.offsetWidth, bar.offsetHeight),
        pointer: CanvasSurface.screenPoint(layer, { x: event.clientX, y: event.clientY }),
        handle: CanvasSurface.screenPoint(layer, centreOf(event.currentTarget)),
        handleInBar: handleInBar(event.currentTarget, bar),
        frame: frameOf(layer.getBoundingClientRect()),
      }),
    );
  };

  return { drag, onGripPointerDown };
}
