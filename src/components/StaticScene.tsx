import { useContext } from "react";

import { CanvasContext } from "../context/CanvasContext";

export const StaticScene = () => {
  const { staticContext } = useContext(CanvasContext);

  return (
    <canvas
      ref={staticContext.canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
};
