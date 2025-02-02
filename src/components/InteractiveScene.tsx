import { useContext } from "react";

import { CanvasContext } from "../context/CanvasContext";
import AppState from "../store/store";

export const InteractiveScene = () => {
  const { interactiveContext } = useContext(CanvasContext);
  const activeTool = AppState((state) => state.activeTool);

  return (
    <canvas
      ref={interactiveContext.canvasRef}
      className={`h-full w-full cursor-${activeTool} absolute inset-0`}
      style={{
        imageRendering: "pixelated",
      }}
      onMouseMove={(e) => {
        if (!interactiveContext.canvasRef.current) return;
        const rect =
          interactiveContext.canvasRef.current.getBoundingClientRect();
        const canvasContext = AppState.getState().canvasContext;
        canvasContext.mouseX = e.clientX - rect.left;
        canvasContext.mouseY = e.clientY - rect.top;
      }}
    />
  );
};
