import { useContext, useEffect } from "react";

import { CanvasContext } from "../context/CanvasContext";

export const StaticScene = () => {
  const { staticContext } = useContext(CanvasContext);

  useEffect(() => {
    if (!staticContext.graphicsContextRef.current) return;
    const ctx = staticContext.graphicsContextRef.current.getContext();

    const draw = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(100, 100);
      ctx.stroke();
      ctx.flush();
    };

    draw();
  }, [staticContext.graphicsContextRef.current]);

  return (
    <canvas
      id="static-canvas"
      ref={staticContext.canvasRef}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
};
