import { useEffect, useRef } from "react";
import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";
import { useCanvasKitRenderer } from "../hooks/useCanvasKitRenderer";
import { getScene } from "../lib/editor/Scene";

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasKit = useCanvasKitRenderer(canvasRef);

  // let's turn editor into a scene
  // and the scene will triggering a redraw
  const editor = getScene();

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const updateCanvasSize = (entries: ResizeObserverEntry[]) => {
      requestAnimationFrame(() => {
        if (!canvasRef.current || !canvasKit.current) return;
        const rect = entries[0].contentRect;
        const canvas = canvasRef.current;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        canvasKit.current.surface.delete();
        canvasKit.current.createSurface(canvas);

        canvasKit.current.canvas.scale(dpr, dpr);

        canvasKit.current.drawCircle(10, 10, 10);
        canvasKit.current.flush();
      });
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
      <EditorView canvasRef={canvasRef} ctx={canvasKit} editor={editor} />
    </>
  );
};
