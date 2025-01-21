import { MouseEventHandler, useEffect, useRef } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "../lib/graphics/skia/skiaRenderer";
import { Editor } from "../lib/editor/editor";


export const EditorView = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editor = editorRef.current;

  useEffect(() => {
    if (!canvasRef.current) return;
    const initRenderer = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        editorRef.current.renderer = new SkiaRenderer(result.data);
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

  const onMouseUp: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    editor.currentTool.onMouseUp(e);
  };

  return (
    <>
      <canvas
        className={`w-full h-full border border-black cursor-${editor.currentTool.name}`}
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />
    </>
  );
};
