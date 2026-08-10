import { FC, useEffect, useRef } from "react";

import { CanvasContextProvider } from "@/context/CanvasContextProvider";
import { useDebugSafe } from "@/context/DebugContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { CompiledProofLayer } from "./CompiledProofLayer";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";

export const Canvas: FC = () => {
  const editor = useEditor();
  const debug = useDebugSafe();

  const containerRef = useRef<HTMLDivElement>(null);

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
      onMouseMove={(e) => {
        editor.updateMousePosition(e.clientX, e.clientY);
      }}
    >
      <CanvasContextProvider>
        <StaticScene />
        <CompiledProofLayer />
        <InteractiveScene />
      </CanvasContextProvider>
      <TextInput />
      {debug?.debugPanelOpen && <DebugPanel />}
    </div>
  );
};
