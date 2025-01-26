import { useEffect, useRef } from "react";
import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";
import { useCanvasKitRenderer } from "../hooks/useCanvasKitRenderer";
import { CanvasContext } from "../lib/editor/CanvasContext";
import { getEditor } from "../lib/editor/Editor";

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasKit = useCanvasKitRenderer(canvasRef);
  const canvasCtx = useRef<CanvasContext | null>(null);
  const editor = getEditor();

  useEffect(() => {
    if (canvasRef.current) {
      canvasCtx.current = new CanvasContext(canvasRef.current);
    }
  }, []);

  return (
    <>
      <Toolbar />
      <EditorView canvasRef={canvasRef} ctx={canvasKit} editor={editor} />
    </>
  );
};
