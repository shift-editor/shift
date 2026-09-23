import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Canvas2DSurface,
  CanvasSurface,
  MarkerCanvasSurface,
} from "../lib/editor/rendering/CanvasSurface";
import { zoomMultiplierFromWheel } from "../lib/transform/zoomFromWheel";
import type { EditorUISession } from "./types";

export interface ShiftEditorProps {
  session: EditorUISession;
}

export function ShiftEditor({ session }: ShiftEditorProps) {
  const { editor } = session;
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const backgroundCanvas = backgroundCanvasRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const markerCanvas = markerCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!backgroundCanvas || !sceneCanvas || !markerCanvas || !overlayCanvas) return undefined;

    let resizeFrame: number | null = null;
    let viewportReady = false;

    const resize = () => {
      resizeFrame = null;
      const backgroundSurface = Canvas2DSurface.from(backgroundCanvas);
      const sceneSurface = Canvas2DSurface.from(sceneCanvas);
      const overlaySurface = Canvas2DSurface.from(overlayCanvas);

      editor.setCameraRect(sceneSurface.rect);
      editor.setMarkerSurface(MarkerCanvasSurface.from(markerCanvas));
      editor.setBackgroundSurface(backgroundSurface);
      editor.setSceneSurface(sceneSurface);
      editor.setOverlaySurface(overlaySurface);

      if (!viewportReady) {
        viewportReady = true;
        editor.zoomToFit();
        setReady(true);
      }
    };

    const scheduleResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(resize);
    };

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(backgroundCanvas);
    observer.observe(sceneCanvas);
    observer.observe(markerCanvas);
    observer.observe(overlayCanvas);
    scheduleResize();

    return () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      editor.clearMarkerCanvas();
    };
  }, [editor]);

  useEffect(() => {
    const container = containerRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !overlayCanvas) return undefined;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const screenPoint = CanvasSurface.localPoint(overlayCanvas, {
        x: event.clientX,
        y: event.clientY,
      });

      if (event.metaKey || event.ctrlKey) {
        editor.zoomToPoint(
          screenPoint.x,
          screenPoint.y,
          zoomMultiplierFromWheel(event.deltaY, event.deltaMode),
        );
        return;
      }

      editor.setPan({ x: editor.pan.x - event.deltaX, y: editor.pan.y - event.deltaY });
    };

    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("contextmenu", preventContextMenu);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [editor]);

  const screenPoint = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      editor.updateMousePosition(event.clientX, event.clientY);
      return CanvasSurface.localPoint(event.currentTarget, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [editor],
  );

  const modifiers = (event: ReactPointerEvent<HTMLCanvasElement>) => ({
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
  });

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;

      activePointerIdRef.current = null;
      editor.toolManager.handlePointerUp(screenPoint(event), modifiers(event));
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [editor, screenPoint],
  );

  return (
    <div
      ref={containerRef}
      className="shift-editor-canvas"
      data-ready={ready}
      onMouseMove={(event) => editor.updateMousePosition(event.clientX, event.clientY)}
    >
      <canvas ref={backgroundCanvasRef} className="shift-editor-canvas__layer" aria-hidden />
      <canvas ref={sceneCanvasRef} className="shift-editor-canvas__layer" aria-hidden />
      <canvas ref={markerCanvasRef} className="shift-editor-canvas__layer" aria-hidden />
      <canvas
        ref={overlayCanvasRef}
        className="shift-editor-canvas__layer shift-editor-canvas__interactive"
        aria-label="Interactive font editor"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          activePointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          editor.toolManager.handlePointerDown(screenPoint(event), modifiers(event));
        }}
        onPointerMove={(event) => {
          if (
            activePointerIdRef.current !== null &&
            activePointerIdRef.current !== event.pointerId
          ) {
            return;
          }
          editor.toolManager.handlePointerMove(screenPoint(event), modifiers(event));
        }}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => {
          if (activePointerIdRef.current !== event.pointerId) return;
          activePointerIdRef.current = null;
          editor.toolManager.cancelPointerGesture();
        }}
        onLostPointerCapture={(event) => {
          if (activePointerIdRef.current !== event.pointerId) return;
          if (event.buttons === 0) finishPointer(event);
        }}
        onPointerLeave={() => {
          if (activePointerIdRef.current === null) editor.input.clearPointer();
        }}
      />
    </div>
  );
}
