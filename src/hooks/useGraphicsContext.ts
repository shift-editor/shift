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

export interface GraphicsContextData {
  interactiveCanvasData: {
    canvasRef: CanvasRef;
    ctxRef: GraphicsContextRef;
  };
  staticCanvasData: {
    canvasRef: CanvasRef;
    ctxRef: GraphicsContextRef;
  };
}

export const useGraphicsContext = (): GraphicsContextData => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);

  const interactiveContextRef = useRef<IGraphicContext | null>(null);
  const staticContextRef = useRef<IGraphicContext | null>(null);

  useEffect(() => {
    const initCanvas = (canvasKit: CanvasKit, canvas: HTMLCanvasElement) => {
      const ctx = new CanvasKitContext(canvasKit);

      ctx.createSurface(canvas);
      scaleCanvasDPR(canvas, ctx);

      return ctx;
    };

    const setUpCanvas = async ({
      interactiveCanvas,
      staticCanvas,
    }: {
      interactiveCanvas: HTMLCanvasElement;
      staticCanvas: HTMLCanvasElement;
    }) => {
      const canvasKit = await initCanvasKit();
      interactiveContextRef.current = initCanvas(canvasKit, interactiveCanvas);
      staticContextRef.current = initCanvas(canvasKit, staticCanvas);

      AppState.getState().canvasContext.setDimensions(
        interactiveCanvas.width,
        interactiveCanvas.height,
      );
    };

    if (!interactiveCanvasRef.current || !staticCanvasRef.current) return;

    setUpCanvas({
      interactiveCanvas: interactiveCanvasRef.current,
      staticCanvas: staticCanvasRef.current,
    });
  }, []);

  return {
    interactiveCanvasData: {
      canvasRef: interactiveCanvasRef,
      ctxRef: interactiveContextRef,
    },
    staticCanvasData: {
      canvasRef: staticCanvasRef,
      ctxRef: staticContextRef,
    },
  };
};
