import { createContext, useEffect, useRef } from "react";

import { Canvas2DContext } from "@/lib/graphics/backends/Canvas2DRenderer";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import { getEditor } from "@/store/store";
import { CanvasRef } from "@/types/graphics";

interface CanvasContext {
  gpuHandlesCanvasRef: CanvasRef;
  interactiveCanvasRef: CanvasRef;
  overlayCanvasRef: CanvasRef;
  staticCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContext>({
  gpuHandlesCanvasRef: { current: null },
  interactiveCanvasRef: { current: null },
  overlayCanvasRef: { current: null },
  staticCanvasRef: { current: null },
});

export const CanvasContextProvider = ({ children }: { children: React.ReactNode }) => {
  const gpuHandlesCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const initCanvas = (canvas: HTMLCanvasElement) => {
      const ctx = new Canvas2DContext();
      ctx.resizeCanvas(canvas);
      return ctx;
    };

    const editor = getEditor();

    const setUpContexts = ({
      gpuHandlesCanvas,
      interactiveCanvas,
      overlayCanvas,
      staticCanvas,
    }: {
      gpuHandlesCanvas: HTMLCanvasElement;
      interactiveCanvas: HTMLCanvasElement;
      overlayCanvas: HTMLCanvasElement;
      staticCanvas: HTMLCanvasElement;
    }) => {
      const gpuHandleContext = new ReglHandleContext();
      const interactiveContext = initCanvas(interactiveCanvas);
      const overlayContext = initCanvas(overlayCanvas);
      const staticContext = initCanvas(staticCanvas);

      gpuHandleContext.resizeCanvas(gpuHandlesCanvas);
      editor.setGpuHandleContext(gpuHandleContext);
      editor.setInteractiveContext(interactiveContext);
      editor.setOverlayContext(overlayContext);
      editor.setStaticContext(staticContext);

      const resizeCanvases = () => {
        gpuHandleContext.resizeCanvas(gpuHandlesCanvas);
        interactiveContext.resizeCanvas(interactiveCanvas);
        overlayContext.resizeCanvas(overlayCanvas);
        staticContext.resizeCanvas(staticCanvas);
        editor.requestImmediateRedraw();
      };

      const resizeCanvasObserver = (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          if (canvas === gpuHandlesCanvas) {
            gpuHandleContext.resizeCanvas(canvas);
          } else if (canvas === interactiveCanvas) {
            interactiveContext.resizeCanvas(canvas);
          } else if (canvas === overlayCanvas) {
            overlayContext.resizeCanvas(canvas);
          } else if (canvas === staticCanvas) {
            staticContext.resizeCanvas(canvas);
          }
        }
        editor.requestImmediateRedraw();
      };

      const observer = new ResizeObserver(resizeCanvasObserver);

      observer.observe(gpuHandlesCanvas);
      observer.observe(interactiveCanvas);
      observer.observe(overlayCanvas);
      observer.observe(staticCanvas);

      const unsubscribeZoom = window.electronAPI?.onUiZoomChanged(() => {
        requestAnimationFrame(() => {
          resizeCanvases();
        });
      });

      return () => {
        observer.disconnect();
        if (unsubscribeZoom) unsubscribeZoom();
        gpuHandleContext.destroy();
        interactiveContext.destroy();
        overlayContext.destroy();
        staticContext.destroy();
      };
    };

    if (
      !gpuHandlesCanvasRef.current ||
      !interactiveCanvasRef.current ||
      !overlayCanvasRef.current ||
      !staticCanvasRef.current
    ) {
      return undefined;
    }

    const cleanup = setUpContexts({
      gpuHandlesCanvas: gpuHandlesCanvasRef.current,
      interactiveCanvas: interactiveCanvasRef.current,
      overlayCanvas: overlayCanvasRef.current,
      staticCanvas: staticCanvasRef.current,
    });

    return cleanup;
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        gpuHandlesCanvasRef,
        interactiveCanvasRef,
        overlayCanvasRef,
        staticCanvasRef,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
