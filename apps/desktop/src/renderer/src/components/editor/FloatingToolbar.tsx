import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
  cn,
} from "@shift/ui";
import { ToolsPane, type ToolsPaneSide } from "@shift/editor/ui";
import { useEditor } from "@/workspace/WorkspaceContext";

// SPIKE: floating, dockable tools. Positions are relative to the canvas panel so
// the bar follows the canvas edge as sidebars open and close.

type Dock = "left" | "right" | "bottom";

const DOCKS: readonly Dock[] = ["left", "bottom", "right"];
const DOCK_STORAGE_KEY = "shift:floating-toolbar-dock";
const DOCK_LABELS: Record<Dock, string> = {
  left: "Dock left",
  bottom: "Dock bottom",
  right: "Dock right",
};
const POPUP_SIDE: Record<Dock, ToolsPaneSide> = { left: "right", right: "left", bottom: "top" };
const DOCK_POSITION: Record<Dock, string> = {
  left: "left-3 top-1/2 -translate-y-1/2",
  right: "right-3 top-1/2 -translate-y-1/2",
  bottom: "bottom-3 left-1/2 -translate-x-1/2",
};
const DROP_ZONE_POSITION: Record<Dock, string> = {
  left: "inset-y-3 left-3 w-14",
  right: "inset-y-3 right-3 w-14",
  bottom: "inset-x-3 bottom-3 h-14",
};

interface DragState {
  /** Pointer position inside the canvas panel. */
  x: number;
  y: number;
  /** Pointer offset from the bar's top-left corner when the drag began. */
  offsetX: number;
  offsetY: number;
  target: Dock;
}

function readDock(): Dock {
  try {
    const stored = localStorage.getItem(DOCK_STORAGE_KEY);
    return DOCKS.find((dock) => dock === stored) ?? "left";
  } catch {
    return "left";
  }
}

function writeDock(dock: Dock): void {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, dock);
  } catch {
    // Remembering the dock is a convenience; the bar works without it.
  }
}

function nearestDock(x: number, y: number, rect: DOMRect): Dock {
  const distances: Record<Dock, number> = {
    left: x,
    right: rect.width - x,
    bottom: rect.height - y,
  };
  return DOCKS.reduce((best, dock) => (distances[dock] < distances[best] ? dock : best));
}

export const FloatingToolbar = () => {
  const editor = useEditor();
  const layerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [dock, setDockState] = useState<Dock>(readDock);
  const [drag, setDrag] = useState<DragState | null>(null);

  const setDock = (next: Dock) => {
    setDockState(next);
    writeDock(next);
  };

  const pointInLayer = (event: ReactPointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
  };

  const onGripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !layerRef.current || !barRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bar = barRef.current.getBoundingClientRect();
    const { x, y } = pointInLayer(event);
    setDrag({
      x,
      y,
      offsetX: event.clientX - bar.left,
      offsetY: event.clientY - bar.top,
      target: dock,
    });
  };

  const onGripPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { x, y, rect } = pointInLayer(event);
    setDrag({ ...drag, x, y, target: nearestDock(x, y, rect) });
  };

  const onGripPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDock(drag.target);
    setDrag(null);
  };

  // While dragging, the bar previews the orientation of the dock it would snap to.
  const activeDock = drag?.target ?? dock;
  const vertical = activeDock !== "bottom";

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-10">
      {drag ? (
        <div
          aria-hidden="true"
          className={cn(
            "absolute rounded-xl border-2 border-dashed border-primary/40 bg-primary/5",
            DROP_ZONE_POSITION[drag.target],
          )}
        />
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger className="contents">
          <div
            ref={barRef}
            className={cn(
              "pointer-events-auto absolute flex items-center gap-1 rounded-xl border border-line-subtle bg-chrome p-1 shadow-lg",
              vertical ? "flex-col" : "flex-row",
              drag ? "opacity-90" : DOCK_POSITION[dock],
            )}
            style={drag ? { left: drag.x - drag.offsetX, top: drag.y - drag.offsetY } : undefined}
          >
            <div
              role="presentation"
              title="Drag to dock"
              className={cn(
                "flex cursor-grab items-center justify-center rounded-md text-muted hover:bg-hover/50 active:cursor-grabbing",
                vertical ? "h-3 w-8" : "h-8 w-3",
              )}
              onPointerDown={onGripPointerDown}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
              onPointerCancel={() => setDrag(null)}
            >
              <span
                className={cn(
                  "rounded-full bg-current opacity-60",
                  vertical ? "h-0.5 w-4" : "h-4 w-0.5",
                )}
              />
            </div>
            <ToolsPane
              editor={editor}
              orientation={vertical ? "vertical" : "horizontal"}
              popupSide={POPUP_SIDE[activeDock]}
              variant="floating"
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuPositioner>
            <ContextMenuPopup>
              {DOCKS.map((option) => (
                <ContextMenuItem
                  key={option}
                  disabled={option === dock}
                  onClick={() => setDock(option)}
                >
                  {DOCK_LABELS[option]}
                </ContextMenuItem>
              ))}
            </ContextMenuPopup>
          </ContextMenuPositioner>
        </ContextMenuPortal>
      </ContextMenu>
    </div>
  );
};
