import { FC, useEffect, useRef, useState } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import { useDebugSafe } from "@/context/DebugContext";
import { effect } from "@/lib/signals/signal";
import { useSignalState } from "@/lib/signals";
import { getEditor } from "@/store/store";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";

const GLYPH_ID_RE = /^[0-9a-f]+$/i;

interface EditorViewProps {
  glyphId: string;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const editor = getEditor();
  const debug = useDebugSafe();
  const containerRef = useRef<HTMLDivElement>(null);
  const fontLoaded = useSignalState(editor.font.$loaded);

  const [cursorStyle, setCursorStyle] = useState(() => editor.cursor);

  useEffect(() => {
    const fx = effect(() => {
      setCursorStyle(editor.cursorCell.value);
    });
    return () => fx.dispose();
  }, [editor]);

  useEffect(() => {
    if (!fontLoaded) return undefined;
    if (!GLYPH_ID_RE.test(glyphId)) return undefined;

    const parsed = Number.parseInt(glyphId, 16);
    if (Number.isNaN(parsed)) return undefined;

    const unicode = parsed;
    const handle = editor.font.glyphHandleForUnicode(unicode);

    const source = editor.font.sourceAtOrDefault(editor.font.defaultLocation());

    editor.openGlyph(handle);
    editor.openGlyphSource(handle, source.id);

    editor.updateMetricsFromFont();

    const toolManager = editor.toolManager;
    const activeToolId = editor.getActiveTool();
    toolManager.activate(activeToolId);

    return () => {
      toolManager.reset();
      editor.close();
    };
  }, [editor, fontLoaded, glyphId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const toolManager = editor.toolManager;

    const handleWheel = (e: WheelEvent) => {
      editor.updateMousePosition(e.clientX, e.clientY);
      const screenPos = editor.getScreenMousePosition();
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const zoomFactor = zoomMultiplierFromWheel(e.deltaY, e.deltaMode);
        editor.zoomToPoint(screenPos.x, screenPos.y, zoomFactor);
      } else {
        const currentPan = editor.pan;
        const newPan = Vec2.sub(currentPan, { x: e.deltaX, y: e.deltaY });
        editor.setPan(newPan);

        toolManager.handlePointerMove(
          screenPos,
          {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
          { force: true },
        );
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
        editor.updateMousePosition(e.clientX, e.clientY);
      }}
    >
      <CanvasContextProvider>
        <StaticScene />
        <InteractiveScene />
      </CanvasContextProvider>
      <TextInput />
      {debug?.debugPanelOpen && <DebugPanel />}
    </div>
  );
};
