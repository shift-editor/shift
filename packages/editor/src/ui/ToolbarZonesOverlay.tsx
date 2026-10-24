import type { CSSProperties, ReactNode } from "react";
import { cn } from "@shift/ui";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { dockZone, type DockZone } from "./toolbarGeometry";
import { ZONE_MARGIN, toolbarBarReach } from "./toolbarDrag";
import { allowedDocksInFrame, isShortToolbarFrame } from "./toolbarPose";

/** Stripes for the neutral centre, which keeps whatever the target already is. */
const NEUTRAL_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgb(217 70 239 / 0.14) 0 2px, transparent 2px 10px)",
};

/** A zone clipped to the frame and grown by `margin`, as absolute-position styles. */
function zoneStyle(zone: DockZone, frame: ToolbarFrame, margin = 0): CSSProperties {
  const left = Math.max(zone.left - margin, 0);
  const top = Math.max(zone.top - margin, 0);
  const right = Math.min(zone.right + margin, frame.width);
  const bottom = Math.min(zone.bottom + margin, frame.height);

  return { left, top, width: right - left, height: bottom - top };
}

/** The centre of the band between top and bottom, owned by neither side. */
function neutralZone(frame: ToolbarFrame): DockZone {
  const left = dockZone("left", frame, false);
  const right = dockZone("right", frame, false);

  return { left: left.right, top: left.top, right: right.left, bottom: left.bottom };
}

function Label({ strong, children }: { strong: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase",
        strong ? "bg-fuchsia-600" : "bg-fuchsia-500/50",
      )}
    >
      {children}
    </span>
  );
}

function Dot({ at, className }: { at: { x: number; y: number }; className: string }) {
  return (
    <div
      className={cn("absolute size-3 -translate-1/2 rounded-full", className)}
      style={{ left: at.x, top: at.y }}
    />
  );
}

export interface ToolbarZonesOverlayProps {
  frame: ToolbarFrame;
  barLength: number;
  dock: ToolbarDock;
  drag: ToolbarDragState | null;
}

/**
 * Debug view of how the carried bar steers the floating toolbar: each slot's
 * zone, the target's zone grown by `ZONE_MARGIN`, the neutral centre, and the
 * bar's reach point, handle and pointer.
 *
 * @remarks
 * Mounted only while the Toolbar Dock Zones debug overlay is on. Drawn in a
 * colour the canvas never uses, so it reads apart from metric guides.
 */
export function ToolbarZonesOverlay({ frame, barLength, dock, drag }: ToolbarZonesOverlayProps) {
  const flatOnly = isShortToolbarFrame(frame, barLength);
  const target = drag?.target ?? dock;

  return (
    <div aria-hidden="true" className="absolute inset-0 font-mono">
      {flatOnly ? null : (
        <div
          style={{ ...zoneStyle(neutralZone(frame), frame), ...NEUTRAL_STYLE }}
          className="absolute"
        />
      )}
      {allowedDocksInFrame(frame, barLength).map((edge) => {
        const isTarget = edge === target;

        return (
          <div
            key={edge}
            style={zoneStyle(dockZone(edge, frame, flatOnly), frame)}
            className={cn(
              "absolute flex items-center justify-center border-2",
              isTarget
                ? "border-fuchsia-500 bg-fuchsia-500/15"
                : "border-fuchsia-500/40 bg-fuchsia-500/5",
            )}
          >
            <Label strong={isTarget}>{edge}</Label>
          </div>
        );
      })}
      {flatOnly ? null : (
        <div className="absolute top-1/2 left-1/2 -translate-1/2">
          <Label strong={false}>keeps target</Label>
        </div>
      )}
      <div
        style={zoneStyle(dockZone(target, frame, flatOnly), frame, ZONE_MARGIN)}
        className="absolute border-2 border-dashed border-fuchsia-600"
      />
      {drag ? (
        <>
          <Dot at={drag.handle} className="border-2 border-fuchsia-600 bg-white" />
          <Dot at={drag.pointer} className="bg-fuchsia-600 ring-2 ring-white" />
          <Dot
            at={toolbarBarReach(drag)}
            className="size-4 bg-fuchsia-600 ring-4 ring-fuchsia-600/30"
          />
        </>
      ) : null}
      <div className="absolute top-2 right-2 flex flex-col gap-1 rounded-md bg-fuchsia-600 px-2 py-1.5 text-[11px] text-white">
        <span>● pointer steers when it leads</span>
        <span>◉ bar reach point steers when it trails</span>
        <span>○ handle</span>
        <span>┄ target + {ZONE_MARGIN}px margin</span>
      </div>
    </div>
  );
}
