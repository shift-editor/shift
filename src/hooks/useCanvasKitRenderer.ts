import { useEffect, useRef } from "react";
import { CanvasKitRenderer } from "../lib/graphics/backends/CanvasKitRenderer";
import InitCanvasKit, { CanvasKit } from "canvaskit-wasm";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export const useCanvasKitRenderer = (
  canvas: React.RefObject<HTMLCanvasElement | null>
) => {
  const contextRef = useRef<CanvasKitRenderer | null>(null);

  useEffect(() => {
    const initCanvasKitContext = async () => {
      if (!canvas.current) return;
      const canvasKit = await initCanvasKit();
      const ctx = new CanvasKitRenderer(canvasKit);

      ctx.createSurface(canvas.current);

      contextRef.current = ctx;
    };

    initCanvasKitContext();
  }, []);

  return contextRef;
};
