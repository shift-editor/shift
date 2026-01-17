import { FC, useEffect, useMemo } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import AppState, { getEditor } from "@/store/store";
import { ToolName } from "@/types/tool";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics as MetricsComponent } from "./Metrics";
import { StaticScene } from "./StaticScene";

function getCursorStyle(tool: ToolName): string {
  switch (tool) {
    case "pen":
      // Use image-set for retina support: 1x (32px) and 2x (64px) versions
      return `-webkit-image-set(url("/cursors/pen@1.svg") 1x, url("/cursors/pen@2.svg") 2x) 16 8, crosshair`;
    case "hand":
      return "grab";
    case "select":
      return "default";
    default:
      return "default";
  }
}

interface EditorViewProps {
  glyphId: string;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  useEffect(() => {
    // Parse glyphId as hex (e.g., "0041" for 'A')
    const unicode = parseInt(glyphId, 16) || 0x41; // Default to 'A' if invalid

    const initEditor = () => {
      // Start Rust edit session for this glyph
      editor.startEditSession(unicode);

      // Update viewport with actual font metrics (UPM, descender, guides)
      editor.updateMetricsFromFont();

      editor.redrawGlyph();
    };

    initEditor();

    editor.activeTool().setReady();

    return () => {
      editor.activeTool().setIdle();
      editor.endEditSession();
    };
  }, [glyphId]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const pan = editor.getPan();

    const dx = e.deltaX;
    const dy = e.deltaY;

    editor.pan(pan.x - dx, pan.y - dy);
    editor.requestRedraw();
  };

  const cursorStyle = useMemo(() => getCursorStyle(activeTool), [activeTool]);

  return (
    <div
      className="relative z-20 h-full w-full overflow-hidden"
      style={{ cursor: cursorStyle }}
      onWheel={onWheel}
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
      <MetricsComponent />
    </div>
  );
};
