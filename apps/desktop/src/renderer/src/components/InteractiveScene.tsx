import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";
import { getEditor } from "@/store/store";

export const InteractiveScene = () => {
  const { interactiveCanvasRef } = useContext(CanvasContext);
  const editor = getEditor();
  const toolManager = editor.getToolManager();

  const getScreenPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const screen = editor.getMousePosition(e.clientX, e.clientY);
    return screen;
  };

  const getModifiers = (e: React.MouseEvent<HTMLCanvasElement>) => ({
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
  });

  return (
    <canvas
      id="interactive-canvas"
      ref={interactiveCanvasRef}
      className="absolute inset-0 z-20 h-full w-full"
      onMouseDown={(e) => {
        toolManager.handlePointerDown(getScreenPoint(e), getModifiers(e));
      }}
      onMouseUp={(e) => {
        toolManager.handlePointerUp(getScreenPoint(e));
      }}
      onMouseMove={(e) => {
        toolManager.handlePointerMove(getScreenPoint(e), getModifiers(e));
      }}
    />
  );
};
