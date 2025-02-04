import { useContext } from "react";

import AppState from "@/store/store";

import { CanvasContext } from "../context/CanvasContext";

export const InteractiveScene = () => {
  const { interactiveContext } = useContext(CanvasContext);

  return (
    <canvas
      id="interactive-canvas"
      ref={interactiveContext.canvasRef}
      className={`absolute inset-0 z-10 h-full w-full`}
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
