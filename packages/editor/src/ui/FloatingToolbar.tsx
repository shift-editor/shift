import { Fragment, useCallback, useRef, useState, type CSSProperties } from "react";
import { cn } from "@shift/ui";
import type { Editor } from "../lib/editor/Editor";
import { useSignalState } from "../lib/signals";
import type { ToolbarDock, ToolbarDragState } from "../types/toolbar";
import { SLOT_FRAME, ToolbarBar } from "./ToolbarBar";
import { BAR_THICKNESS } from "./toolbarGeometry";
import { toolbarBarOrigin, toolbarLift, toolbarToolOpacity } from "./toolbarDrag";
import { TOOLBAR_DOCKS, fitDockToFrame, poseForDock } from "./toolbarPose";
import { ToolbarZonesOverlay } from "./ToolbarZonesOverlay";
import { useToolbarDrag } from "./useToolbarDrag";
import { useToolbarMetrics } from "./useToolbarMetrics";

/** A thin line along the whole of each canvas edge, marking where the bar lands on release. */
const EDGE_LINE_POSITION: Record<ToolbarDock, string> = {
  top: "inset-x-0 top-0 h-0.5",
  bottom: "inset-x-0 bottom-0 h-0.5",
  left: "inset-y-0 left-0 w-0.5",
  right: "inset-y-0 right-0 w-0.5",
};

/** Strong ease-out; ease-in would hold the old bar just as the eye looks at it. */
const PREVIEW_STYLE: CSSProperties = { transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" };

/** Slot the bar sits in: its dock, or its starting slot until the pointer pulls it loose. */
function slotOf(drag: ToolbarDragState | null, dock: ToolbarDock): ToolbarDock | null {
  if (!drag) return dock;
  if (drag.tether) return drag.seatDock;

  return null;
}

function followStyleOf(drag: ToolbarDragState | null, slot: ToolbarDock | null): CSSProperties {
  if (!drag || slot) return {};

  const origin = toolbarBarOrigin(drag);

  return { left: origin.x, top: origin.y };
}

export interface FloatingToolbarProps {
  editor: Editor;
  /**
   * Edge the bar is docked to. Leave unset to let the bar keep its own dock,
   * starting on the bottom edge.
   */
  dock?: ToolbarDock;
  /** Called when the user drops the bar on an edge, so the host can remember it. */
  onDockChange?: (dock: ToolbarDock) => void;
}

/**
 * Renders the editor's tools as a bar floating over the canvas, docked to an
 * edge the user picks by dragging its handle.
 *
 * @remarks
 * Place it inside the canvas container, which must be positioned: the bar
 * fills that container as an overlay and docks against its edges, so it
 * follows the canvas as surrounding panels resize. Pass `dock` and
 * `onDockChange` to keep the dock across sessions; the bar stores nothing
 * itself. A canvas too short to hold the bar standing shows it on the bottom
 * edge without changing `dock`.
 */
export function FloatingToolbar({ editor, dock: hostDock, onDockChange }: FloatingToolbarProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [ownDock, setOwnDock] = useState<ToolbarDock>("bottom");
  const dock = hostDock ?? ownDock;
  const commitDock = useCallback(
    (next: ToolbarDock) => {
      setOwnDock(next);
      if (onDockChange) onDockChange(next);
    },
    [onDockChange],
  );
  const metrics = useToolbarMetrics(layerRef);
  const showZones = useSignalState(editor.debugOverlaysCell).toolbarZones;
  const shownDock = metrics ? fitDockToFrame(dock, metrics.frame, metrics.barLength) : dock;
  const previewLength = metrics?.barLength ?? 0;
  const { drag, onGripPointerDown } = useToolbarDrag({
    layerRef,
    dock: shownDock,
    onDock: commitDock,
  });

  const pose = poseForDock(drag ? drag.seatDock : shownDock);
  const slot = slotOf(drag, shownDock);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-30">
      {drag ? (
        // Covers the window while dragging so the grabbing cursor holds over the
        // canvas, sidebars, and buttons, none of which react until the drop.
        <div
          aria-hidden="true"
          className="pointer-events-auto fixed inset-0 z-50 cursor-grabbing"
        />
      ) : null}
      {showZones && metrics ? (
        <ToolbarZonesOverlay
          frame={metrics.frame}
          barLength={metrics.barLength}
          dock={shownDock}
          drag={drag}
        />
      ) : null}
      {/*
        A landing preview for every edge stays mounted and fades with CSS, so
        it fades in once the bar comes loose, crossfades as the target edge
        changes, and fades out on drop. Some edge is always the target, so
        the bar never lands anywhere unmarked.
      */}
      {TOOLBAR_DOCKS.map((edge) => {
        const shown = drag !== null && drag.tether === null && drag.target === edge;
        const vertical = poseForDock(edge) === "stand";

        return (
          <Fragment key={edge}>
            <div
              aria-hidden="true"
              style={PREVIEW_STYLE}
              className={cn(
                "absolute bg-accent transition-opacity duration-150",
                shown ? "opacity-100" : "opacity-0",
                EDGE_LINE_POSITION[edge],
              )}
            />
            {/* Outlines exactly where the bar will sit, sized for that edge's orientation. */}
            <div aria-hidden="true" className={cn("absolute", SLOT_FRAME[edge])}>
              <div
                style={{
                  ...PREVIEW_STYLE,
                  width: vertical ? BAR_THICKNESS : previewLength,
                  height: vertical ? previewLength : BAR_THICKNESS,
                }}
                className={cn(
                  "rounded-xl border-2 border-dashed border-accent/60 bg-accent/10 transition duration-150 motion-reduce:scale-100",
                  shown ? "scale-100 opacity-100" : "scale-98 opacity-0",
                )}
              />
            </div>
          </Fragment>
        );
      })}
      <ToolbarBar
        editor={editor}
        dock={shownDock}
        pose={pose}
        slot={slot}
        followStyle={followStyleOf(drag, slot)}
        dragging={drag !== null}
        lift={toolbarLift(drag)}
        toolOpacity={toolbarToolOpacity(drag)}
        onGripPointerDown={onGripPointerDown}
      />
    </div>
  );
}
