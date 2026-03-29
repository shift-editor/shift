import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";

export const StaticScene = () => {
  const { staticCanvasRef, gpuHandlesCanvasRef } = useContext(CanvasContext);

  return (
    <>
      <canvas
        id="static-canvas"
        ref={staticCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full bg-canvas"
      />
      <canvas
        id="gpu-handles-canvas"
        ref={gpuHandlesCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </>
  );
};
