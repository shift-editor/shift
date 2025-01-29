import { useEffect, useRef } from "react";
import { CanvasKitRenderer } from "../lib/graphics/backends/CanvasKitRenderer";
import InitCanvasKit, { CanvasKit } from "canvaskit-wasm";
import { IRenderer } from "../types/renderer";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export const useCanvasKitRenderer = (
  canvas: React.RefObject<HTMLCanvasElement | null>
): React.RefObject<IRenderer | null> => {
  const contextRef = useRef<IRenderer | null>(null);

  useEffect(() => {
    const initCanvasKitContext = async () => {
      if (!canvas.current) return;
      const canvasKit = await initCanvasKit();
      const ctx = new CanvasKitRenderer(canvasKit);
      canvasKit.MakeSurface

      ctx.createSurface(canvas.current);

      contextRef.current = ctx;
    };

    initCanvasKitContext();
  }, []);

  return contextRef;
};
