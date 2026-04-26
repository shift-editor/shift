import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";

export const StaticScene = () => {
  const { backgroundCanvasRef, sceneCanvasRef, gpuHandlesCanvasRef } = useContext(CanvasContext);

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
        id="gpu-handles-canvas"
        ref={gpuHandlesCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </>
  );
};
