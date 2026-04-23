import { createContext, useEffect, useRef } from "react";

import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import { getEditor } from "@/store/store";
import { CanvasRef } from "@/types/graphics";

interface CanvasContext {
  gpuHandlesCanvasRef: CanvasRef;
  overlayCanvasRef: CanvasRef;
  sceneCanvasRef: CanvasRef;
  backgroundCanvasRef: CanvasRef;
}

export const CanvasContext = createContext<CanvasContext>({
  gpuHandlesCanvasRef: { current: null },
  overlayCanvasRef: { current: null },
  sceneCanvasRef: { current: null },
  backgroundCanvasRef: { current: null },
});

function scaledContext(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  rect: DOMRect;
} {
  const dpr = window.devicePixelRatio;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");
  ctx.scale(dpr, dpr);
  return { ctx, rect };
}

function resize2DCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const { ctx, rect } = scaledContext(canvas);

  const editor = getEditor();
  editor.setViewportRect({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  });

  return ctx;
}

export const CanvasContextProvider = ({ children }: { children: React.ReactNode }) => {
  const gpuHandlesCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const editor = getEditor();

    const setUpContexts = ({
      gpuHandlesCanvas,
      overlayCanvas,
      sceneCanvas,
      backgroundCanvas,
    }: {
      gpuHandlesCanvas: HTMLCanvasElement;
      overlayCanvas: HTMLCanvasElement;
      sceneCanvas: HTMLCanvasElement;
      backgroundCanvas: HTMLCanvasElement;
    }) => {
      const gpuHandleContext = new ReglHandleContext();

      const bgCtx = scaledContext(backgroundCanvas).ctx;
      const sceneCtx = scaledContext(sceneCanvas).ctx;
      const overlayCtx = scaledContext(overlayCanvas).ctx;

      gpuHandleContext.resizeCanvas(gpuHandlesCanvas);

      editor.setBackgroundContext(bgCtx);
      editor.setSceneContext(sceneCtx);
      editor.setOverlayContext(overlayCtx);
      editor.setGpuHandleContext(gpuHandleContext);

      // Set initial viewport rect from the scene canvas
      const rect = sceneCanvas.getBoundingClientRect();
      editor.setViewportRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });

      const resizeCanvases = () => {
        gpuHandleContext.resizeCanvas(gpuHandlesCanvas);
        editor.setBackgroundContext(resize2DCanvas(backgroundCanvas));
        editor.setSceneContext(resize2DCanvas(sceneCanvas));
        editor.setOverlayContext(resize2DCanvas(overlayCanvas));
        editor.requestImmediateRedraw();
      };

      const resizeCanvasObserver = (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          switch (canvas) {
            case gpuHandlesCanvas:
              gpuHandleContext.resizeCanvas(canvas);
              break;
            case backgroundCanvas:
              editor.setBackgroundContext(resize2DCanvas(canvas));
              break;
            case sceneCanvas:
              editor.setSceneContext(resize2DCanvas(canvas));
              break;
            case overlayCanvas:
              editor.setOverlayContext(resize2DCanvas(canvas));
              break;
          }
        }
        editor.requestImmediateRedraw();
      };

      const observer = new ResizeObserver(resizeCanvasObserver);

      observer.observe(gpuHandlesCanvas);
      observer.observe(overlayCanvas);
      observer.observe(sceneCanvas);
      observer.observe(backgroundCanvas);

      const unsubscribeZoom = window.electronAPI?.onUiZoomChanged(() => {
        requestAnimationFrame(() => {
          resizeCanvases();
        });
      });

      return () => {
        observer.disconnect();
        if (unsubscribeZoom) unsubscribeZoom();
        gpuHandleContext.destroy();
      };
    };

    if (
      !gpuHandlesCanvasRef.current ||
      !overlayCanvasRef.current ||
      !sceneCanvasRef.current ||
      !backgroundCanvasRef.current
    ) {
      return undefined;
    }

    const cleanup = setUpContexts({
      gpuHandlesCanvas: gpuHandlesCanvasRef.current,
      overlayCanvas: overlayCanvasRef.current,
      sceneCanvas: sceneCanvasRef.current,
      backgroundCanvas: backgroundCanvasRef.current,
    });

    return cleanup;
  }, []);

  return (
    <CanvasContext.Provider
      value={{
        gpuHandlesCanvasRef,
        overlayCanvasRef,
        sceneCanvasRef,
        backgroundCanvasRef,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
