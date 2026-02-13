import { FC, useEffect, useRef, useState } from "react";

import { CanvasContextProvider } from "@/context/CanvasContext";
import { effect } from "@/lib/reactive/signal";
import { getEditor } from "@/store/store";
import { glyphDataStore } from "@/store/GlyphDataStore";

import { zoomMultiplierFromWheel } from "@/lib/transform";
import { InteractiveScene } from "./InteractiveScene";
import { OverlayScene } from "./OverlayScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "./debug/DebugPanel";
import { Vec2 } from "@shift/geo";

interface EditorViewProps {
  glyphId: string;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const editor = getEditor();
  const containerRef = useRef<HTMLDivElement>(null);

  const [cursorStyle, setCursorStyle] = useState(() => editor.getCursor());

  useEffect(() => {
    const fx = effect(() => {
      setCursorStyle(editor.getCursor());
    });
    return () => fx.dispose();
  }, [editor]);

  useEffect(() => {
    // Parse glyphId as hex (e.g., "0041" for 'A')
    const parsed = Number.parseInt(glyphId, 16);
    const unicode = Number.isNaN(parsed) ? 0x41 : parsed;

    const initEditor = () => {
      editor.setMainGlyphUnicode(unicode);
      // Start Rust edit session for this glyph
      editor.startEditSession(unicode);

      // Update viewport with actual font metrics (UPM, descender, guides)
      editor.updateMetricsFromFont();

      editor.requestRedraw();
    };

    initEditor();

    const toolManager = editor.toolManager;
    const activeToolId = editor.getActiveTool();
    toolManager.activate(activeToolId);

    return () => {
      toolManager.reset();
      glyphDataStore.invalidateGlyph(unicode);
      editor.endEditSession();
    };
  }, [glyphId]);

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
        editor.requestRedraw();
      } else {
        const currentPan = editor.pan;
        const newPan = Vec2.sub(currentPan, { x: e.deltaX, y: e.deltaY });
        editor.setPan(newPan.x, newPan.y);

        toolManager.handlePointerMove(
          screenPos,
          {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
          { force: true },
        );
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
        editor.updateMousePosition(e.clientX, e.clientY);
      }}
    >
      <CanvasContextProvider>
        <StaticScene />
        <OverlayScene />
        <InteractiveScene />
      </CanvasContextProvider>
      <DebugPanel />
    </div>
  );
};
