import { useEffect, useRef } from "react";
import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";
import { useGraphicsContext } from "../hooks/useGraphicsContext";

const UPM = 1000;
const CANVAS_PADDING = 200;

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctx = useGraphicsContext(canvasRef);

  useEffect(() => {
    const updateCanvasSize = (entries: ResizeObserverEntry[]) => {
      if (!canvasRef.current || !ctx.current) return;
      const rect = entries[0].contentRect;
      const canvas = canvasRef.current;

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.floor(rect.width * dpr);
      const displayHeight = Math.floor(rect.height * dpr);

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      ctx.current.recreateSurface(canvas);
      const renderer = ctx.current.getContext();
      renderer.scale(dpr, dpr);
    };

    if (!canvasRef.current) return;

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(canvasRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <Toolbar />
      <EditorView canvasRef={canvasRef} ctx={ctx} />
    </>
  );
};
