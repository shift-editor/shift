import { FC, useEffect, useRef, useState } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import { effect } from "@/lib/reactive/signal";
import { getEditor } from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";

interface EditorViewProps {
  glyphId: string;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const editor = getEditor();
  const containerRef = useRef<HTMLDivElement>(null);

  const [cursorStyle, setCursorStyle] = useState(() => editor.cursor.get());

  useEffect(() => {
    const fx = effect(() => {
      setCursorStyle(editor.cursor.get());
    });
    return () => fx.dispose();
  }, [editor]);

  useEffect(() => {
    // Parse glyphId as hex (e.g., "0041" for 'A')
    const unicode = parseInt(glyphId, 16) || 0x41; // Default to 'A' if invalid

    const initEditor = () => {
      // Start Rust edit session for this glyph
      editor.startEditSession(unicode);

      // Update viewport with actual font metrics (UPM, descender, guides)
      editor.updateMetricsFromFont();

      editor.requestRedraw();
    };

    initEditor();

    const toolManager = editor.getToolManager();
    const activeToolId = editor.activeTool.peek();
    toolManager.activate(activeToolId);

    return () => {
      toolManager.reset();
      editor.endEditSession();
    };
  }, [glyphId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const position = editor.getMousePosition(e.clientX, e.clientY);
        const ZOOM_SENSITIVITY = 100;
        const zoomFactor = 1 - e.deltaY / ZOOM_SENSITIVITY;
        editor.zoomToPoint(position.x, position.y, zoomFactor);
        editor.requestRedraw();
      } else {
        const pan = editor.getPan();
        const dx = e.deltaX;
        const dy = e.deltaY;
        editor.pan(pan.x - dx, pan.y - dy);
        editor.requestRedraw();
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative z-20 h-full w-full overflow-hidden"
      style={{ cursor: cursorStyle }}
      onMouseMove={(e) => {
        const position = editor.getMousePosition(e.clientX, e.clientY);
        const { x, y } = editor.projectScreenToUpm(position.x, position.y);
        editor.setUpmMousePosition(x, y);
      }}
    >
      <CanvasContextProvider>
        <StaticScene />
        <InteractiveScene />
      </CanvasContextProvider>
    </div>
  );
};
