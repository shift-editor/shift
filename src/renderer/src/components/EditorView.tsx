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
    const fetchFontData = async () => {
      const guides = {
        ascender: { y: 100 },
        capHeight: { y: 100 },
        xHeight: { y: 100 },
        descender: { y: 100 },
        baseline: { y: 0 },
        xAdvance: 100,
      };

      editor.constructGuidesPath(guides);
      editor.setViewportUpm(1000);

      editor.loadContours([]);
      editor.redrawGlyph();
    };

    fetchFontData();

    editor.activeTool().setReady();

    return () => {
      editor.activeTool().setIdle();
      editor.clearContours();
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
