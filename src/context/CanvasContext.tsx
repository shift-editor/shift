import { createContext, useEffect } from "react";

import { useGraphicsContext } from "../hooks/useGraphicsContext";
import { scaleCanvasDPR } from "../lib/utils/utils";
import AppState from "../store/store";
import { CanvasRef, GraphicsContextRef } from "../types/graphics";

interface CanvasContext {
  canvasRef: CanvasRef;
  graphicsContextRef: GraphicsContextRef;
}

interface CanvasContextType {
  interactiveContext: CanvasContext;
  staticContext: CanvasContext;
}

export const CanvasContext = createContext<CanvasContextType>({
  interactiveContext: {
    canvasRef: { current: null },
    graphicsContextRef: { current: null },
  },
  staticContext: {
    canvasRef: { current: null },
    graphicsContextRef: { current: null },
  },
});

export const CanvasContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { interactiveCanvasData, staticCanvasData } = useGraphicsContext();

  useEffect(() => {
    const updateCanvasSize = () => {
      for (const canvasData of [interactiveCanvasData, staticCanvasData]) {
        if (!canvasData.canvasRef.current || !canvasData.ctxRef.current)
          continue;

        const ctx = canvasData.ctxRef.current;
        const canvas = canvasData.canvasRef.current;
        ctx.recreateSurface(canvas);
        scaleCanvasDPR(canvas, ctx);
      }

      if (!interactiveCanvasData.canvasRef.current) return;
      const { width, height } = interactiveCanvasData.canvasRef.current;
      AppState.getState().canvasContext.setDimensions(width, height);
    };

    if (
      !interactiveCanvasData.canvasRef.current ||
      !staticCanvasData.canvasRef.current
    )
      return;

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(interactiveCanvasData.canvasRef.current);
    observer.observe(staticCanvasData.canvasRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        interactiveContext: {
          canvasRef: interactiveCanvasData.canvasRef,
          graphicsContextRef: interactiveCanvasData.ctxRef,
        },
        staticContext: {
          canvasRef: staticCanvasData.canvasRef,
          graphicsContextRef: staticCanvasData.ctxRef,
        },
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
