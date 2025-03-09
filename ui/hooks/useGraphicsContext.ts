import { useEffect, useRef, useState } from 'react';

import InitCanvasKit, { CanvasKit } from 'canvaskit-wasm';

import { CanvasKitContext } from '../lib/graphics/backends/CanvasKitRenderer';
import { scaleCanvasDPR } from '../lib/utils/utils';
import AppState from '../store/store';
import { CanvasRef } from '../types/graphics';

export const initCanvasKit = async (): Promise<CanvasKit> => {
  return await InitCanvasKit({
    locateFile: () => `/canvaskit.wasm`,
  });
};

export interface GraphicsContextData {
  interactiveCanvasData: {
    canvasRef: CanvasRef;
  };
  staticCanvasData: {
    canvasRef: CanvasRef;
  };
}

export const useGraphicsContext = (): GraphicsContextData => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);

  const [_, setIsReady] = useState(false);

  useEffect(() => {
    const initCanvas = (canvasKit: CanvasKit, canvas: HTMLCanvasElement) => {
      const ctx = new CanvasKitContext(canvasKit);

      ctx.createSurface(canvas);
      scaleCanvasDPR(canvas);

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
      const interactiveContext = initCanvas(canvasKit, interactiveCanvas);
      const staticContext = initCanvas(canvasKit, staticCanvas);

      AppState.getState().editor.setInteractiveContext(interactiveContext);
      AppState.getState().editor.setStaticContext(staticContext);

      setIsReady(true);
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
    },
    staticCanvasData: {
      canvasRef: staticCanvasRef,
    },
  };
};
