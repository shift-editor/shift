import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";
import AppState from "@/store/store";

export const InteractiveScene = () => {
  const { interactiveCanvasRef } = useContext(CanvasContext);
  const editor = AppState.getState().editor;
  const activeTool = editor.activeTool();

  return (
    <canvas
      id="interactive-canvas"
      ref={interactiveCanvasRef}
      className="absolute inset-0 z-20 h-full w-full"
      onMouseDown={(e) => {
        activeTool.onMouseDown(e);
      }}
      onMouseUp={(e) => {
        activeTool.onMouseUp(e);
      }}
      onMouseMove={(e) => {
        activeTool.onMouseMove(e);
      }}
    />
  );
};
