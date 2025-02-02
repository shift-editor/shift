import { useEffect, useRef } from "react";

import InitCanvasKit, { CanvasKit } from "canvaskit-wasm";

import { CanvasKitContext } from "../lib/graphics/backends/CanvasKitRenderer";
import { scaleCanvasDPR } from "../lib/utils/utils";
import AppState from "../store/store";
import {
  CanvasRef,
  GraphicsContextRef,
  IGraphicContext,
} from "../types/graphics";

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export const useGraphicsContext = (
  staticCanvas: CanvasRef,
  interactiveCanvas: CanvasRef,
): {
  interactiveContextRef: GraphicsContextRef;
  staticContextRef: GraphicsContextRef;
} => {
  const interactiveContextRef = useRef<IGraphicContext | null>(null);
  const staticContextRef = useRef<IGraphicContext | null>(null);

  useEffect(() => {
    const initCanvas = (canvasKit: CanvasKit, canvas: HTMLCanvasElement) => {
      const ctx = new CanvasKitContext(canvasKit);

      scaleCanvasDPR(canvas, ctx);

      AppState.getState().canvasContext.setDimensions(
        canvas.width,
        canvas.height,
      );

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
