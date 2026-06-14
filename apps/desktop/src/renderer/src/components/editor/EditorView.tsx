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
import type { GlyphName } from "@shift/types";

interface EditorViewProps {
  glyphName: GlyphName;
}

export const EditorView: FC<EditorViewProps> = ({ glyphName }) => {
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

    const handle = editor.font.glyphHandleForName(glyphName);
    if (!handle) return undefined;

    let cancelled = false;
    const toolManager = editor.toolManager;

    void (async () => {
      const source = editor.font.sourceAtOrDefault(editor.font.defaultLocation());

      // Glyph-name-first: opening a cell that has no committed record yet
      // creates the glyph in the workspace, then opens it.
      const record = editor.font.recordForName(handle.name) ?? editor.createGlyph(handle.name);

      // Pull replace-grade state and materialize the editable model before
      // the session opens; folds keep it current afterwards.
      const glyph = await editor.font.openGlyph(record.id, source);
      if (!glyph || cancelled) return;

      editor.openGlyph(handle);
      editor.openGlyphSource(handle, source.id);

      editor.updateMetricsFromFont();
      toolManager.activate(editor.getActiveTool());
    })();

    return () => {
      cancelled = true;
      toolManager.reset();
      editor.close();
    };
  }, [editor, fontLoaded, glyphName]);

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
