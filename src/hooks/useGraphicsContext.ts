import { useEffect, useRef } from "react";
import { CanvasKitContext } from "../lib/graphics/backends/CanvasKitRenderer";
import InitCanvasKit, { CanvasKit } from "canvaskit-wasm";
import { IGraphicContext } from "../types/graphics";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export const useGraphicsContext = (
  canvas: React.RefObject<HTMLCanvasElement | null>
): React.RefObject<IGraphicContext | null> => {
  const contextRef = useRef<IGraphicContext | null>(null);

  useEffect(() => {
    const initCanvasKitContext = async () => {
      if (!canvas.current) return;
      const canvasKit = await initCanvasKit();
      const ctx = new CanvasKitContext(canvasKit);

      const rect = canvas.current.getBoundingClientRect();

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.floor(rect.width * dpr);
      const displayHeight = Math.floor(rect.height * dpr);

      canvas.current.width = displayWidth;
      canvas.current.height = displayHeight;

      ctx.createSurface(canvas.current);

      const renderer = ctx.getContext();
      renderer.scale(dpr, dpr);

      contextRef.current = ctx;
    };

    initCanvasKitContext();
  }, []);

  return contextRef;
};
