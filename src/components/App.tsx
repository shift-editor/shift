import { useEffect, useRef } from "react";
import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";
import { useGraphicsContext } from "../hooks/useGraphicsContext";
import AppState from "../store/store";
import { dprWH } from "../lib/utils/utils";

export const App = () => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const { interactiveContextRef, staticContextRef } = useGraphicsContext(
    interactiveCanvasRef,
    staticCanvasRef
  );

  useEffect(() => {
    const updateCanvasSize = (entries: ResizeObserverEntry[]) => {
      if (!interactiveCanvasRef.current || !interactiveContextRef.current)
        return;

      const ctx = interactiveContextRef.current;
      const rect = entries[0].contentRect;
      const canvas = interactiveCanvasRef.current;

      const { width, height, dpr } = dprWH(rect.width, rect.height);

      canvas.width = width;
      canvas.height = height;

      AppState.getState().scene.width = width;
      AppState.getState().scene.height = height;

      ctx.recreateSurface(canvas);
      const renderer = ctx.getContext();
      renderer.scale(dpr, dpr);
    };

    if (!interactiveCanvasRef.current) return;

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(interactiveCanvasRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <Toolbar />
      <EditorView
        interactiveCanvasRef={interactiveCanvasRef}
        staticCanvasRef={staticCanvasRef}
        interactiveContextRef={interactiveContextRef}
        staticContextRef={staticContextRef}
      />
    </>
  );
};
