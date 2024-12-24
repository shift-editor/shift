import { MouseEventHandler, useEffect, useRef } from "react";
import { Editor } from "../lib/editor/editor";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "../lib/graphics/skia/skiaRenderer";

export const EditorView = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SkiaRenderer | null>(null);
  const editor = new Editor(canvasRef);

  useEffect(() => {
    if (!canvasRef.current) return;
    const initRenderer = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        rendererRef.current = new SkiaRenderer(result.data);
      } catch (error) {
        console.log(error);
      }
    };

    initRenderer(canvasRef.current);
  }, []);

  const onMouseDown: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    editor.currentTool.onMouseDown(e);
  };

  const onMouseMove: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    editor.currentTool.onMouseMove(e);
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      className="w-full h-full border border-black"
    ></canvas>
  );
};
