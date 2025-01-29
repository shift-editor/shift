import { useEffect, useRef } from "react";
import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";
import { useCanvasKitRenderer } from "../hooks/useCanvasKitRenderer";
import { getScene } from "../lib/editor/Scene";

const UPM = 1000;
const CANVAS_PADDING = 200;

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasKit = useCanvasKitRenderer(canvasRef);

  const scene = getScene();

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    const updateCanvasSize = (entries: ResizeObserverEntry[]) => {
      if (!canvasRef.current || !canvasKit.current) return;
      const rect = entries[0].contentRect;
      const canvas = canvasRef.current;

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.floor(rect.width * dpr);
      const displayHeight = Math.floor(rect.height * dpr);

      canvasKit.current.recreateSurface(canvas);

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      canvasKit.current.canvas.scale(dpr, dpr);
      canvasKit.current.clear();

      canvasKit.current.drawCircle(200, 200, 50);
      canvasKit.current.flush();
      canvasKit.current.canvas.restore();
    };

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <Toolbar />
      <EditorView canvasRef={canvasRef} ctx={canvasKit} scene={scene} />
    </>
  );
};
