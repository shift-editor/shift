import { useCallback, useEffect, useRef, useState, type FC } from "react";

import { cn } from "@shift/ui";

import { CanvasContextProvider } from "@/context/CanvasContextProvider";
import { CanvasSurface } from "@shift/editor/rendering";
import { useDebugSafe } from "@/context/DebugContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { WheelGesture, zoomMultiplierFromWheel } from "@shift/editor/transform";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";

export const Canvas: FC = () => {
  const editor = useEditor();
  const debug = useDebugSafe();

  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportReady, setViewportReady] = useState(false);
  const onViewportReady = useCallback(() => setViewportReady(true), []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const toolManager = editor.toolManager;
    const interactiveCanvas = element.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!interactiveCanvas) return undefined;

    const wheelGesture = new WheelGesture();

    const handleWheel = (e: WheelEvent) => {
      const screenPos = CanvasSurface.localPoint(interactiveCanvas, { x: e.clientX, y: e.clientY });
      editor.updateMousePosition(e.clientX, e.clientY);
      editor.flushMousePosition();

      switch (
        wheelGesture.classify({ timeStamp: e.timeStamp, zoomModifier: e.metaKey || e.ctrlKey })
      ) {
        case "zoom": {
          e.preventDefault();
          const zoomFactor = zoomMultiplierFromWheel(e.deltaY, e.deltaMode);
          editor.zoomToPoint(screenPos.x, screenPos.y, zoomFactor);
          return;
        }
        case "ignore":
          e.preventDefault();
          return;
        case "pan":
          break;
      }

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
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, [editor]);

  return (
    <div
      ref={containerRef}
      data-testid="editor-canvas-stack"
      className={cn("relative z-20 h-full w-full overflow-hidden", !viewportReady && "invisible")}
      onMouseMove={(e) => {
        editor.updateMousePosition(e.clientX, e.clientY);
      }}
    >
      <CanvasContextProvider onViewportReady={onViewportReady}>
        <StaticScene />
        <InteractiveScene />
      </CanvasContextProvider>
      <TextInput />
      {debug?.debugPanelOpen && <DebugPanel />}
    </div>
  );
};
