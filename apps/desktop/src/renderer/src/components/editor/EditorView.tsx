import { FC, useEffect, useRef, useState } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import { useDebugSafe } from "@/context/DebugContext";
import { effect } from "@/lib/signals/signal";
import { useSignalState } from "@/lib/signals";
import { getEditor } from "@/store/appStore";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";
import type { GlyphId } from "@shift/types";

interface EditorViewProps {
  glyphId: GlyphId;
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

    const record = editor.font.recordForId(glyphId);
    if (!record) {
      editor.scene.clear();
      return undefined;
    }

    let cancelled = false;
    const toolManager = editor.toolManager;

    void (async () => {
      await editor.setEditorSceneGlyph(record.id);
      if (cancelled) return;

      editor.updateMetricsFromFont();
      toolManager.activate(editor.getActiveTool());
    })();

    return () => {
      cancelled = true;
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
