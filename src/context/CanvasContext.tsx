import { createContext, useEffect, useRef } from "react";

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
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);

  const { interactiveContextRef, staticContextRef } = useGraphicsContext(
    interactiveCanvasRef,
    staticCanvasRef,
  );

  useEffect(() => {
    const updateCanvasSize = () => {
      if (
        !interactiveCanvasRef.current ||
        !interactiveContextRef.current ||
        !staticContextRef.current ||
        !staticCanvasRef.current
      )
        return;

      const ctx = interactiveContextRef.current;

      for (const canvas of [
        interactiveCanvasRef.current,
        staticCanvasRef.current,
      ]) {
        scaleCanvasDPR(canvas, ctx);
      }

      AppState.getState().canvasContext.setDimensions(
        interactiveCanvasRef.current.width,
        interactiveCanvasRef.current.height,
      );
    };

    if (!interactiveCanvasRef.current) return;

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(interactiveCanvasRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        interactiveContext: {
          canvasRef: interactiveCanvasRef,
          graphicsContextRef: interactiveContextRef,
        },
        staticContext: {
          canvasRef: staticCanvasRef,
          graphicsContextRef: staticContextRef,
        },
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
