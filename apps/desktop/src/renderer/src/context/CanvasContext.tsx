import { createContext, useEffect, useRef } from "react";

import { Canvas2DContext } from "@/lib/graphics/backends/Canvas2DRenderer";
import { getEditor } from "@/store/store";
import { CanvasRef } from "@/types/graphics";

interface CanvasContext {
  interactiveCanvasRef: CanvasRef;
  staticCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContext>({
  interactiveCanvasRef: { current: null },
  staticCanvasRef: { current: null },
});

export const CanvasContextProvider = ({ children }: { children: React.ReactNode }) => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const initCanvas = (canvas: HTMLCanvasElement) => {
      const ctx = new Canvas2DContext();
      ctx.resizeCanvas(canvas);
      return ctx;
    };

    const editor = getEditor();

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

      const resizeCanvases = () => {
        interactiveContext.resizeCanvas(interactiveCanvas);
        staticContext.resizeCanvas(staticCanvas);
        editor.requestImmediateRedraw();
      };

      const resizeCanvasObserver = (entries: ResizeObserverEntry[]) => {
        const [interactiveEntry, staticEntry] = entries;

        interactiveContext.resizeCanvas(interactiveEntry.target as HTMLCanvasElement);
        staticContext.resizeCanvas(staticEntry.target as HTMLCanvasElement);

        editor.requestImmediateRedraw();
      };

      const observer = new ResizeObserver(resizeCanvasObserver);

      observer.observe(interactiveCanvas);
      observer.observe(staticCanvas);

      const unsubscribeZoom = window.electronAPI?.onUiZoomChanged(() => {
        // Wait for browser to recalculate layout after zoom change
        requestAnimationFrame(() => {
          resizeCanvases();
        });
      });

      return () => {
        observer.disconnect();
        unsubscribeZoom?.();
      };
    };

    if (!interactiveCanvasRef.current || !staticCanvasRef.current) return undefined;

    const cleanup = setUpContexts({
      interactiveCanvas: interactiveCanvasRef.current,
      staticCanvas: staticCanvasRef.current,
    });

    return cleanup;
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
