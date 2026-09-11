import { useCallback, useEffect, useRef, useState, type FC } from "react";

import { cn } from "@shift/ui";

import { CanvasContextProvider } from "@/context/CanvasContextProvider";
import { CanvasSurface } from "@/lib/editor/rendering/CanvasSurface";
import { useDebugSafe } from "@/context/DebugContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { getShiftHost } from "@/host/shiftHost";
import { objectIsKindOf } from "@/types";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";
import { DebugPanel } from "../debug/DebugPanel";
import { TextInput } from "../text/HiddenTextInput";
import { Vec2 } from "@shift/geo";

const WHEEL_GESTURE_IDLE_MS = 120;

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

    let wheelGestureMode = "idle";
    let wheelGestureEndTimer: number | null = null;

    const scheduleWheelGestureEnd = () => {
      if (wheelGestureEndTimer !== null) window.clearTimeout(wheelGestureEndTimer);

      wheelGestureEndTimer = window.setTimeout(() => {
        wheelGestureMode = "idle";
        wheelGestureEndTimer = null;
      }, WHEEL_GESTURE_IDLE_MS);
    };

    const handleWheel = (e: WheelEvent) => {
      const screenPos = CanvasSurface.localPoint(interactiveCanvas, { x: e.clientX, y: e.clientY });
      editor.updateMousePosition(e.clientX, e.clientY);
      editor.flushMousePosition();

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        wheelGestureMode = "zoom";
        scheduleWheelGestureEnd();

        const zoomFactor = zoomMultiplierFromWheel(e.deltaY, e.deltaMode);
        editor.zoomToPoint(screenPos.x, screenPos.y, zoomFactor);
        return;
      }

      if (wheelGestureMode === "zoom") {
        e.preventDefault();
        scheduleWheelGestureEnd();
        return;
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

    const handleContextMenu = async (event: MouseEvent) => {
      event.preventDefault();

      try {
        const [id] = editor.selection.ids;
        const object = id ? editor.object(id) : null;
        const makeFirstPoint =
          editor.sessionMode !== "preview" &&
          editor.selection.ids.length === 1 &&
          objectIsKindOf(object, "point") &&
          object.layer?.sourceId === editor.activeSourceId &&
          object.geometry.point(object.pointId)?.isOnCurve === true &&
          object.geometry.contour(object.contourId)?.closed === true;
        await getShiftHost().menu.showCanvasContextMenu(makeFirstPoint);
      } catch (error) {
        console.error("canvas context menu failed", error);
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("contextmenu", handleContextMenu);
    return () => {
      if (wheelGestureEndTimer !== null) window.clearTimeout(wheelGestureEndTimer);
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  return (
    <div
      ref={containerRef}
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
