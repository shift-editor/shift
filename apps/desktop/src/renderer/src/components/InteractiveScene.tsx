import { useContext, useCallback } from "react";

import { CanvasContext } from "@/context/CanvasContext";
import { getEditor } from "@/store/store";

export const InteractiveScene = () => {
  const { interactiveCanvasRef } = useContext(CanvasContext);
  const editor = getEditor();
  const toolManager = editor.getToolManager();

  const getScreenPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    editor.updateMousePosition(e.clientX, e.clientY);
    return editor.screenMousePosition;
  };

  const getModifiers = (e: React.MouseEvent<HTMLCanvasElement>) => ({
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
  });

  const getCanvasBounds = useCallback(() => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }, [interactiveCanvasRef]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const screenPoint = getScreenPoint(e);
      toolManager.handlePointerMove(screenPoint, getModifiers(e));

      const bounds = getCanvasBounds();
      if (bounds) {
        editor.updateEdgePan({ x: e.clientX, y: e.clientY }, bounds);
      }
    },
    [toolManager, editor, getCanvasBounds],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      toolManager.handlePointerUp(getScreenPoint(e));
      editor.stopEdgePan();
    },
    [toolManager, editor],
  );

  return (
    <canvas
      id="interactive-canvas"
      ref={interactiveCanvasRef}
      className="absolute inset-0 z-20 h-full w-full"
      onMouseDown={(e) => {
        toolManager.handlePointerDown(getScreenPoint(e), getModifiers(e));
      }}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
    />
  );
};
