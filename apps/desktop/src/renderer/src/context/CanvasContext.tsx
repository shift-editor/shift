import { createContext, useEffect, useRef } from "react";

import { Canvas2DContext } from "@/lib/graphics/backends/Canvas2DRenderer";
import AppState from "@/store/store";
import { CanvasRef } from "@/types/graphics";

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

  useEffect(() => {
    const initCanvas = (canvas: HTMLCanvasElement) => {
      const ctx = new Canvas2DContext();
      ctx.resizeCanvas(canvas);
      return ctx;
    };

    const editor = AppState.getState().editor;

    const setUpContexts = ({
      interactiveCanvas,
      staticCanvas,
    }: {
      interactiveCanvas: HTMLCanvasElement;
      staticCanvas: HTMLCanvasElement;
    }) => {
      const interactiveContext = initCanvas(interactiveCanvas);
      const staticContext = initCanvas(staticCanvas);

      editor.setInteractiveContext(interactiveContext);
      editor.setStaticContext(staticContext);

      const resizeCanvas = (entries: ResizeObserverEntry[]) => {
        const [interactiveCanvas, staticCanvas] = entries;

        interactiveContext.resizeCanvas(
          interactiveCanvas.target as HTMLCanvasElement,
        );
        staticContext.resizeCanvas(staticCanvas.target as HTMLCanvasElement);

        editor.requestImmediateRedraw();
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
