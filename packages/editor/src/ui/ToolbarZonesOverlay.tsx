import type { ReactNode } from "react";
import { Vec2, type Point2D } from "@shift/geo";
import { cn } from "@shift/ui";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { BAR_THICKNESS, centreHalfPolygon, dockRegionPolygon } from "./toolbarGeometry";
import {
  REGION_MARGIN,
  toolbarBarCentre,
  toolbarBarOrigin,
  toolbarBarTip,
  toolbarClaims,
} from "./toolbarDrag";
import {
  TOOLBAR_DOCKS,
  allowedDocksInFrame,
  isShortToolbarFrame,
  poseForDock,
} from "./toolbarPose";

function pointsAttribute(points: readonly Point2D[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function centroid(points: readonly Point2D[]): Point2D {
  const total = points.reduce((sum, point) => Vec2.add(sum, point), Vec2.zero());

  return Vec2.scale(total, 1 / points.length);
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

/** Square of `±REGION_MARGIN` around `at`: how far a claim from that point reaches into a region. */
function MarginBox({ at, className }: { at: Point2D; className: string }) {
  return (
    <div
      className={cn("absolute -translate-1/2 border border-dashed", className)}
      style={{ left: at.x, top: at.y, width: REGION_MARGIN * 2, height: REGION_MARGIN * 2 }}
    />
  );
}

/** The carried bar drawn where it sits, so the handle and the tip can be read against it. */
function BarOutline({ drag }: { drag: ToolbarDragState }) {
  const origin = toolbarBarOrigin(drag);
  const stands = poseForDock(drag.seatDock) === "stand";
  const width = stands ? BAR_THICKNESS : drag.length;
  const height = stands ? drag.length : BAR_THICKNESS;

  return (
    <div
      className="absolute rounded-md border-2 border-fuchsia-600/70 bg-fuchsia-600/5"
      style={{ left: origin.x, top: origin.y, width, height }}
    />
  );
}

function DragSteering({
  drag,
  claims,
}: {
  drag: ToolbarDragState;
  claims: readonly ToolbarDock[];
}) {
  const tip = toolbarBarTip(drag);
  const centre = toolbarBarCentre(drag);
  const readout = claims.length > 0 ? claims.join(", ") : "none (holding)";

  return (
    <>
      <BarOutline drag={drag} />
      <svg className="absolute inset-0 size-full overflow-visible">
        <line
          x1={drag.handle.x}
          y1={drag.handle.y}
          x2={tip.x}
          y2={tip.y}
          className="stroke-fuchsia-600 stroke-2 [stroke-dasharray:2_4]"
        />
      </svg>
      <MarginBox at={drag.handle} className="border-fuchsia-600/70" />
      <MarginBox at={tip} className="border-fuchsia-600/70" />
      <Dot at={centre} className="size-2 bg-fuchsia-600/50" />
      <Dot at={drag.handle} className="border-2 border-fuchsia-600 bg-white" />
      <Dot at={tip} className="size-4 bg-fuchsia-600 ring-4 ring-fuchsia-600/30" />
      <div
        className="absolute -translate-x-1/2 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[11px] text-white"
        style={{ left: drag.handle.x, top: drag.handle.y + REGION_MARGIN + 8 }}
      >
        claims: {readout} → {drag.target}
      </div>
    </>
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
 * square splits into across the seat's axis, the carried bar with the two
 * points that steer (handle and tip) and their margins, and which docks claim
 * the bar right now.
 *
 * @remarks
 * Mounted only while the Toolbar Dock Zones debug overlay is on. Drawn in a
 * colour the canvas never uses, so it reads apart from metric guides.
 */
export function ToolbarZonesOverlay({ frame, barLength, dock, drag }: ToolbarZonesOverlayProps) {
  const flatOnly = isShortToolbarFrame(frame, barLength);
  const target = drag?.target ?? dock;
  const seat = drag?.seatDock ?? dock;
  const claims = drag ? toolbarClaims(drag) : [];

  return (
    <div aria-hidden="true" className="absolute inset-0 font-mono">
      <svg className="absolute inset-0 size-full overflow-visible">
        {allowedDocksInFrame(frame, barLength).map((edge) => {
          const isTarget = edge === target;
          const isClaiming = claims.includes(edge);

          return (
            <polygon
              key={edge}
              points={pointsAttribute(dockRegionPolygon(edge, frame, barLength, flatOnly, seat))}
              className={cn(
                isClaiming ? "stroke-[5]" : "stroke-2",
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
            <Label strong={edge === target}>
              {edge}
              {claims.includes(edge) ? " · claims" : ""}
            </Label>
          </div>
        );
      })}
      {drag ? <DragSteering drag={drag} claims={claims} /> : null}
      <div className="absolute top-2 right-2 flex flex-col gap-1 rounded-md bg-fuchsia-600 px-2 py-1.5 text-[11px] text-white">
        <span>○ handle leads to bottom and right</span>
        <span>
          ◉ tip (handle reflected through the bar centre) leads to top (standing) and left (flat)
        </span>
        <span>
          ┄ ±{REGION_MARGIN}px margin: the target keeps a region through it, a tip must be that deep
          to take it
        </span>
        <span>thick outline: dock claims the bar now (tip claims beat handle claims)</span>
        <span>▨ centre square splits across the seat axis</span>
        <span>
          corners: the near rectangle goes across the seat axis, the rest splits on the diagonal
        </span>
      </div>
    </div>
  );
}
