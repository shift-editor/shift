import { createContext, useEffect, useRef } from "react";

import { Canvas2DContext } from "@/lib/graphics/backends/Canvas2DRenderer";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import { getEditor } from "@/store/store";
import { CanvasRef } from "@/types/graphics";

interface CanvasContext {
  interactiveCanvasRef: CanvasRef;
  overlayCanvasRef: CanvasRef;
  staticCanvasRef: CanvasRef;
  gpuHandlesCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContext>({
  interactiveCanvasRef: { current: null },
  overlayCanvasRef: { current: null },
  staticCanvasRef: { current: null },
  gpuHandlesCanvasRef: { current: null },
});

export const CanvasContextProvider = ({ children }: { children: React.ReactNode }) => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuHandlesCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const initCanvas = (canvas: HTMLCanvasElement) => {
      const ctx = new Canvas2DContext();
      ctx.resizeCanvas(canvas);
      return ctx;
    };

    const editor = getEditor();

    const setUpContexts = ({
      interactiveCanvas,
      overlayCanvas,
      staticCanvas,
      gpuHandlesCanvas,
    }: {
      interactiveCanvas: HTMLCanvasElement;
      overlayCanvas: HTMLCanvasElement;
      staticCanvas: HTMLCanvasElement;
      gpuHandlesCanvas: HTMLCanvasElement;
    }) => {
      const interactiveContext = initCanvas(interactiveCanvas);
      const overlayContext = initCanvas(overlayCanvas);
      const staticContext = initCanvas(staticCanvas);
      const gpuHandleContext = new ReglHandleContext();
      gpuHandleContext.resizeCanvas(gpuHandlesCanvas);

      editor.setInteractiveContext(interactiveContext);
      editor.setOverlayContext(overlayContext);
      editor.setStaticContext(staticContext);
      editor.setGpuHandleContext(gpuHandleContext);

      const resizeCanvases = () => {
        interactiveContext.resizeCanvas(interactiveCanvas);
        overlayContext.resizeCanvas(overlayCanvas);
        staticContext.resizeCanvas(staticCanvas);
        gpuHandleContext.resizeCanvas(gpuHandlesCanvas);
        editor.requestImmediateRedraw();
      };

      const resizeCanvasObserver = (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          if (canvas === interactiveCanvas) {
            interactiveContext.resizeCanvas(canvas);
          } else if (canvas === overlayCanvas) {
            overlayContext.resizeCanvas(canvas);
          } else if (canvas === staticCanvas) {
            staticContext.resizeCanvas(canvas);
          } else if (canvas === gpuHandlesCanvas) {
            gpuHandleContext.resizeCanvas(canvas);
          }
        }
        editor.requestImmediateRedraw();
      };

      const observer = new ResizeObserver(resizeCanvasObserver);

      observer.observe(interactiveCanvas);
      observer.observe(overlayCanvas);
      observer.observe(staticCanvas);
      observer.observe(gpuHandlesCanvas);

      const unsubscribeZoom = window.electronAPI?.onUiZoomChanged(() => {
        requestAnimationFrame(() => {
          resizeCanvases();
        });
      });

      return () => {
        observer.disconnect();
        unsubscribeZoom?.();
      };
    };

    if (
      !interactiveCanvasRef.current ||
      !overlayCanvasRef.current ||
      !staticCanvasRef.current ||
      !gpuHandlesCanvasRef.current
    ) {
      return undefined;
    }

    const cleanup = setUpContexts({
      interactiveCanvas: interactiveCanvasRef.current,
      overlayCanvas: overlayCanvasRef.current,
      staticCanvas: staticCanvasRef.current,
      gpuHandlesCanvas: gpuHandlesCanvasRef.current,
    });

    return cleanup;
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        interactiveCanvasRef,
        overlayCanvasRef,
        staticCanvasRef,
        gpuHandlesCanvasRef,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
