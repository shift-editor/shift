import { FC, MouseEventHandler, useEffect, useRef, useState } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "../lib/graphics/skia/skiaRenderer";
import { Editor } from "../lib/editor/Editor";

export const EditorView = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const initRenderer = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        editorRef.current = Editor.initialize(canvas);
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
    editorRef.current?.currentTool.onMouseDown(e);
  };

  const onMouseMove: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    editorRef.current?.currentTool.onMouseMove(e);
  };

  const onMouseUp: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    editorRef.current?.currentTool.onMouseUp(e);
  };

  return (
    <>
      <canvas
        className={`w-full h-full border border-black cursor-${editorRef.current?.currentTool.name}`}
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />
    </>
  );
};
