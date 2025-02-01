import { useEffect, useRef } from "react";
import { CanvasKitContext } from "../lib/graphics/backends/CanvasKitRenderer";
import InitCanvasKit, { CanvasKit } from "canvaskit-wasm";
import { IGraphicContext } from "../types/graphics";
import AppState from "../store/store";
import { dprWH } from "../lib/utils/utils";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export const useGraphicsContext = (
  staticCanvas: React.RefObject<HTMLCanvasElement | null>,
  interactiveCanvas: React.RefObject<HTMLCanvasElement | null>
): {
  interactiveContextRef: React.RefObject<IGraphicContext | null>;
  staticContextRef: React.RefObject<IGraphicContext | null>;
} => {
  const interactiveContextRef = useRef<IGraphicContext | null>(null);
  const staticContextRef = useRef<IGraphicContext | null>(null);

  useEffect(() => {
    const initCanvas = (canvasKit: CanvasKit, canvas: HTMLCanvasElement) => {
      const ctx = new CanvasKitContext(canvasKit);

      const rect = canvas.getBoundingClientRect();

      const { width, height, dpr } = dprWH(rect.width, rect.height);

      canvas.width = width;
      canvas.height = height;

      AppState.getState().scene.width = width;
      AppState.getState().scene.height = height;

      ctx.createSurface(canvas);

      const renderer = ctx.getContext();
      renderer.scale(dpr, dpr);

      interactiveContextRef.current = ctx;
    };

    const setUpCanvas = async ({
      interactiveCanvas,
      staticCanvas,
    }: {
      interactiveCanvas: HTMLCanvasElement;
      staticCanvas: HTMLCanvasElement;
    }) => {
      const canvasKit = await initCanvasKit();
      initCanvas(canvasKit, interactiveCanvas);
      initCanvas(canvasKit, staticCanvas);
    };

    if (!interactiveCanvas.current || !staticCanvas.current) return;

    setUpCanvas({
      interactiveCanvas: interactiveCanvas.current,
      staticCanvas: staticCanvas.current,
    });
  }, []);

  return {
    interactiveContextRef,
    staticContextRef,
  };
};
