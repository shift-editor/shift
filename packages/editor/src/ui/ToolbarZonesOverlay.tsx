import type { ReactNode } from "react";
import type { Point2D } from "@shift/geo";
import { cn } from "@shift/ui";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { centreHalfPolygon, dockRegionPolygon } from "./toolbarGeometry";
import { toolbarBarCentre } from "./toolbarDrag";
import { TOOLBAR_DOCKS, allowedDocksInFrame, isShortToolbarFrame } from "./toolbarPose";

function pointsAttribute(points: readonly Point2D[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function centroid(points: readonly Point2D[]): Point2D {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });

  return { x: total.x / points.length, y: total.y / points.length };
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

function Dot({ at, className }: { at: Point2D; className: string }) {
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
 * Debug view of how the carried bar steers the floating toolbar: the region
 * each dock owns, the target's region highlighted, the two halves the centre
 * square splits into across the seat's axis, and the two points that steer.
 *
 * @remarks
 * Mounted only while the Toolbar Dock Zones debug overlay is on. Drawn in a
 * colour the canvas never uses, so it reads apart from metric guides.
 */
export function ToolbarZonesOverlay({ frame, barLength, dock, drag }: ToolbarZonesOverlayProps) {
  const flatOnly = isShortToolbarFrame(frame, barLength);
  const target = drag?.target ?? dock;
  const seat = drag?.seatDock ?? dock;

  return (
    <div aria-hidden="true" className="absolute inset-0 font-mono">
      <svg className="absolute inset-0 size-full overflow-visible">
        {allowedDocksInFrame(frame, barLength).map((edge) => {
          const isTarget = edge === target;

          return (
            <polygon
              key={edge}
              points={pointsAttribute(dockRegionPolygon(edge, frame, barLength, flatOnly, seat))}
              className={cn(
                "stroke-2",
                isTarget
                  ? "fill-fuchsia-500/15 stroke-fuchsia-500"
                  : "fill-fuchsia-500/5 stroke-fuchsia-500/40",
              )}
            />
          );
        })}
        {flatOnly
          ? null
          : TOOLBAR_DOCKS.map((edge) => {
              const half = centreHalfPolygon(edge, frame, barLength, seat);
              if (half.length === 0) return null;

              return (
                <polygon
                  key={`half-${edge}`}
                  points={pointsAttribute(half)}
                  className={cn(
                    "stroke-1 [stroke-dasharray:4_4]",
                    edge === target
                      ? "fill-fuchsia-500/30 stroke-fuchsia-500"
                      : "fill-fuchsia-500/10 stroke-fuchsia-500/60",
                  )}
                />
              );
            })}
      </svg>
      {allowedDocksInFrame(frame, barLength).map((edge) => {
        const at = centroid(dockRegionPolygon(edge, frame, barLength, flatOnly, seat));

        return (
          <div key={edge} className="absolute -translate-1/2" style={{ left: at.x, top: at.y }}>
            <Label strong={edge === target}>{edge}</Label>
          </div>
        );
      })}
      {drag ? (
        <>
          <Dot at={drag.handle} className="border-2 border-fuchsia-600 bg-white" />
          <Dot
            at={toolbarBarCentre(drag)}
            className="size-4 bg-fuchsia-600 ring-4 ring-fuchsia-600/30"
          />
        </>
      ) : null}
      <div className="absolute top-2 right-2 flex flex-col gap-1 rounded-md bg-fuchsia-600 px-2 py-1.5 text-[11px] text-white">
        <span>○ handle leads to bottom and right</span>
        <span>◉ bar centre leads to top (standing) and left (flat)</span>
        <span>▨ centre square splits across the seat axis</span>
        <span>
          corners: the near rectangle goes across the seat axis, the rest splits on the diagonal
        </span>
      </div>
    </div>
  );
}
