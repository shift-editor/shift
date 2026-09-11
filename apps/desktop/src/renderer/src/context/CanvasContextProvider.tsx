import { useEffect, useRef, type ReactNode } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { Canvas2DSurface, MarkerCanvasSurface } from "@/lib/editor/rendering/CanvasSurface";
import { CanvasContext } from "./CanvasContext";

export const CanvasContextProvider = ({
  children,
  onViewportReady,
}: {
  children: ReactNode;
  onViewportReady: () => void;
}) => {
  const editor = useEditor();
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const setUpContexts = ({
      markerCanvas,
      overlayCanvas,
      sceneCanvas,
      backgroundCanvas,
    }: {
      markerCanvas: HTMLCanvasElement;
      overlayCanvas: HTMLCanvasElement;
      sceneCanvas: HTMLCanvasElement;
      backgroundCanvas: HTMLCanvasElement;
    }) => {
      let resizeFrame: number | null = null;
      let viewportReady = false;

      const resizeCanvases = () => {
        resizeFrame = null;

        const backgroundSurface = Canvas2DSurface.from(backgroundCanvas);
        const sceneSurface = Canvas2DSurface.from(sceneCanvas);
        const overlaySurface = Canvas2DSurface.from(overlayCanvas);

        editor.setCameraRect(sceneSurface.rect);
        editor.setMarkerSurface(MarkerCanvasSurface.from(markerCanvas));
        editor.setBackgroundSurface(backgroundSurface);
        editor.setSceneSurface(sceneSurface);
        editor.setOverlaySurface(overlaySurface);

        if (viewportReady) return;

        viewportReady = true;
        onViewportReady();
      };

      const scheduleResizeCanvases = () => {
        if (resizeFrame !== null) return;
        resizeFrame = requestAnimationFrame(resizeCanvases);
      };

      const observer = new ResizeObserver(scheduleResizeCanvases);

      observer.observe(markerCanvas);
      observer.observe(overlayCanvas);
      observer.observe(sceneCanvas);
      observer.observe(backgroundCanvas);
      scheduleResizeCanvases();

      return () => {
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        observer.disconnect();
        editor.clearMarkerCanvas();
      };
    };

    if (
      !markerCanvasRef.current ||
      !overlayCanvasRef.current ||
      !sceneCanvasRef.current ||
      !backgroundCanvasRef.current
    ) {
      return undefined;
    }

    const cleanup = setUpContexts({
      markerCanvas: markerCanvasRef.current,
      overlayCanvas: overlayCanvasRef.current,
      sceneCanvas: sceneCanvasRef.current,
      backgroundCanvas: backgroundCanvasRef.current,
    });

    return cleanup;
  }, [editor, onViewportReady]);

  return (
    <CanvasContext.Provider
      value={{
        markerCanvasRef,
        overlayCanvasRef,
        sceneCanvasRef,
        backgroundCanvasRef,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};
