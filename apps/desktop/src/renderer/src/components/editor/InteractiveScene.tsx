import { useContext, useCallback, useRef } from "react";

import { CanvasContext } from "@/context/CanvasContext";
import { useEditor } from "@/workspace/WorkspaceContext";

export const InteractiveScene = () => {
  const { overlayCanvasRef } = useContext(CanvasContext);
  const editor = useEditor();
  const toolManager = editor.toolManager;
  const activePointerIdRef = useRef<number | null>(null);

  const getScreenPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      editor.updateMousePosition(e.clientX, e.clientY);
      const bounds = overlayCanvasRef.current?.getBoundingClientRect();
      if (bounds) {
        return {
          x: e.clientX - bounds.left,
          y: e.clientY - bounds.top,
        };
      }
      return editor.getScreenMousePosition();
    },
    [editor],
  );

  const getModifiers = (e: React.PointerEvent<HTMLCanvasElement>) => ({
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
  });

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== null && activePointerIdRef.current !== e.pointerId) {
        return;
      }

      const screenPoint = getScreenPoint(e);
      toolManager.handlePointerMove(screenPoint, getModifiers(e));
    },
    [toolManager, getScreenPoint],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;

      toolManager.handlePointerUp(getScreenPoint(e), getModifiers(e));

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      activePointerIdRef.current = null;
    },
    [toolManager, getScreenPoint],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;

      toolManager.cancelPointerGesture();
      activePointerIdRef.current = null;
    },
    [toolManager],
  );

  return (
    <canvas
      id="interactive-canvas"
      ref={overlayCanvasRef}
      className="absolute inset-0 h-full w-full touch-none"
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;

        activePointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        toolManager.handlePointerDown(getScreenPoint(e), getModifiers(e));
      }}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    />
  );
};
