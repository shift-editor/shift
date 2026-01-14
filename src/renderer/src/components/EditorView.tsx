import { FC, useEffect } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import AppState, { getEditor } from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics as MetricsComponent } from "./Metrics";
import { StaticScene } from "./StaticScene";

interface EditorViewProps {
  glyphId: string;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  useEffect(() => {
    // Parse glyphId to get unicode (e.g., "65" for 'A')
    const unicode = parseInt(glyphId, 10) || 65; // Default to 'A' if invalid

    const initEditor = () => {
      const guides = {
        ascender: { y: 800 },
        capHeight: { y: 700 },
        xHeight: { y: 500 },
        descender: { y: -200 },
        baseline: { y: 0 },
        xAdvance: 600,
      };

      editor.constructGuidesPath(guides);
      editor.setViewportUpm(1000);

      // Start Rust edit session for this glyph
      editor.startEditSession(unicode);
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

  return (
    <div
      className={`relative z-20 h-full w-full overflow-hidden cursor-${activeTool}`}
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
