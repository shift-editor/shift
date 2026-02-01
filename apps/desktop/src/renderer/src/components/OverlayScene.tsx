import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";

export const OverlayScene = () => {
  const { overlayCanvasRef } = useContext(CanvasContext);

  return (
    <canvas
      id="overlay-canvas"
      ref={overlayCanvasRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  );
};
