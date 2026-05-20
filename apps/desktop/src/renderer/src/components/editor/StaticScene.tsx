import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";

export const StaticScene = () => {
  const { backgroundCanvasRef, sceneCanvasRef, markerCanvasRef } =
    useContext(CanvasContext);

  return (
    <>
      <canvas
        id="background-canvas"
        ref={backgroundCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full bg-canvas"
      />
      <canvas
        id="scene-canvas"
        ref={sceneCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        id="marker-canvas"
        ref={markerCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </>
  );
};
