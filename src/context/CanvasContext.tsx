import { createContext, useEffect, useRef, useState } from "react";

import { CanvasKit } from "canvaskit-wasm";

import {
  CanvasKitContext,
  initCanvasKit,
} from "@/lib/graphics/backends/CanvasKitRenderer";
import { scaleCanvasDPR } from "@/lib/utils/utils";

import AppState from "../store/store";
import { CanvasRef } from "../types/graphics";

interface CanvasContext {
  interactiveCanvasRef: CanvasRef;
  staticCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContext>({
  interactiveCanvasRef: { current: null },
  staticCanvasRef: { current: null },
});

export const CanvasContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
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

    const setUpContexts = async ({
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

      const resizeCanvas = () => {
        if (!interactiveCanvasRef.current || !staticCanvasRef.current) return;

        interactiveContext.resizeCanvas(interactiveCanvasRef.current);
        staticContext.resizeCanvas(staticCanvasRef.current);
      };

      const observer = new ResizeObserver(resizeCanvas);

      observer.observe(interactiveCanvas);
      observer.observe(staticCanvas);

      return () => {
        observer.disconnect();
      };
    };

    if (!interactiveCanvasRef.current || !staticCanvasRef.current) return;

    setUpContexts({
      interactiveCanvas: interactiveCanvasRef.current,
      staticCanvas: staticCanvasRef.current,
    });
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        interactiveCanvasRef,
        staticCanvasRef,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
