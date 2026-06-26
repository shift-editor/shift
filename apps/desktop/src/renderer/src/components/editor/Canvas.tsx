import { FC, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";

import { CanvasContextProvider } from "@/context/CanvasContext";
import { useDebugSafe } from "@/context/DebugContext";
import { useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";
import { asGlyphId } from "@shift/types";

export const Canvas: FC = () => {
  const editor = useEditor();
  const debug = useDebugSafe();
  const { glyphId: glyphIdParam } = useParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const cursorStyle = useSignalState(editor.cursorCell);

  useEffect(() => {
    if (!glyphIdParam) {
      editor.scene.clear();
      return;
    }

    const glyphId = asGlyphId(glyphIdParam);
    if (!editor.font.hasGlyph(glyphId)) {
      editor.scene.clear();
      return;
    }

    const itemId = editor.scene.addGlyph({ glyphId, origin: { x: 0, y: 0 } });
    editor.scene.setGeometryItems([itemId]);

    return () => {
      editor.scene.clear();
    };
  }, [glyphIdParam]);

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
