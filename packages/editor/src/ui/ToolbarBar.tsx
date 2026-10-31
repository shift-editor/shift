import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Vec2 } from "@shift/geo";
import { cn } from "@shift/ui";
import type { Editor } from "../lib/editor/Editor";
import type {
  ToolbarBarMotion,
  ToolbarBarPlace,
  ToolbarDock,
  ToolbarLift,
  ToolbarPose,
} from "../types/toolbar";
import { ShiftIcon } from "./ShiftIcon";
import { springEasing, type Spring, type SpringEasing } from "./springEasing";
import { ToolsPane, type ToolsPaneSide } from "./ToolsPane";
import { centreOf } from "./toolbarGeometry";
import { poseAngle } from "./toolbarPose";
import { toolDipKeyframes } from "./toolbarPresence";

/** Each slot is a strip along its edge that centres the bar with flex. */
export const SLOT_FRAME: Record<ToolbarDock, string> = {
  top: "inset-x-3 top-3 flex justify-center",
  bottom: "inset-x-3 bottom-3 flex justify-center",
  left: "inset-y-3 left-3 flex flex-col justify-center",
  right: "inset-y-3 right-3 flex flex-col justify-center",
};

const POPUP_SIDE: Record<ToolbarDock, ToolsPaneSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Pulled out of a slot mid-drag: catches up with the pointer almost at once. */
const DETACH_SPRING: Spring = { visualDuration: 0.1, bounce: 0 };
/** Dropped into a slot: a little longer, landing with a small bump. */
const DROP_SPRING: Spring = { visualDuration: 0.22, bounce: 0.15 };
/** The bar turning about its handle. */
const TURN_SPRING: Spring = { visualDuration: 0.24, bounce: 0.08 };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function slideSpring(dragging: boolean): Spring {
  return dragging ? DETACH_SPRING : DROP_SPRING;
}

/** Shadow per lift: a carried bar casts more. */
const LIFT_CLASS: Record<ToolbarLift, string> = {
  rest: "card-shadow",
  lifted: "shadow-xl",
};

/** The tools re-render only when the bar's layout or popup side changes, not on every pointer move. */
const BarTools = memo(ToolsPane);

function isRunning(animation: Animation): boolean {
  return animation.playState === "running" || animation.pending;
}

/** Slide offset and turn of whatever animation is running on the bar right now. */
function readRunningMotion(bar: HTMLElement, animations: readonly Animation[]): ToolbarBarMotion {
  if (!animations.some(isRunning)) return { translate: { x: 0, y: 0 }, rotateDeg: 0 };

  const style = getComputedStyle(bar);
  const [x = "0", y = "0"] = style.translate === "none" ? [] : style.translate.split(" ");
  const rotateDeg = style.rotate === "none" ? 0 : Number.parseFloat(style.rotate);

  return { translate: { x: Number.parseFloat(x), y: Number.parseFloat(y) }, rotateDeg };
}

export interface ToolbarBarProps {
  editor: Editor;
  /** Slot the bar is docked to, which sets where tooltips and menus open. */
  dock: ToolbarDock;
  pose: ToolbarPose;
  /** Slot the bar sits in, or null while it follows the pointer. */
  slot: ToolbarDock | null;
  /** Position while it follows the pointer. */
  followStyle: CSSProperties;
  dragging: boolean;
  lift: ToolbarLift;
  onGripPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * The tools bar in its real layout for the current pose.
 *
 * @remarks
 * When the pose or slot changes, the bar is laid out in its new place at once
 * and a slide and a turn about the handle animate from where it was drawn.
 * During a turn the tools dim to `TOOL_TURN_OPACITY` early in the swing and are
 * back before it settles, pinned to the turn's progress rather than the clock,
 * so the icons swing quietly with the bar and are legible on arrival.
 */
export function ToolbarBar({
  editor,
  dock,
  pose,
  slot,
  followStyle,
  dragging,
  lift,
  onGripPointerDown,
}: ToolbarBarProps) {
  const vertical = pose === "stand";
  const barRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<ToolbarBarPlace | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const placeKey = `${slot ?? "free"}:${pose}`;
  const dipRef = useRef<Animation | null>(null);

  async function dipTools(turning: SpringEasing) {
    const tools = toolsRef.current;
    if (!tools) return;

    dipRef.current?.cancel();
    tools.inert = true;
    const dip = tools.animate(toolDipKeyframes(turning.timeAtProgress), {
      duration: turning.duration,
      easing: "linear",
    });
    dipRef.current = dip;

    try {
      await dip.finished;
    } catch {
      // A newer dip cancelled this one and restores the tools itself.
      return;
    }

    if (dipRef.current !== dip) return;

    dipRef.current = null;
    tools.inert = false;
  }

  useLayoutEffect(() => {
    const bar = barRef.current;
    const grip = gripRef.current;
    if (!bar || !grip) return;

    const last = placeRef.current;
    const moved = last !== null && last.key !== placeKey;
    const running = readRunningMotion(bar, animationsRef.current);
    if (moved) {
      for (const animation of animationsRef.current) animation.cancel();
    }

    // Rotation is about the handle, so only a slide moves it.
    const gripCentre = centreOf(grip);
    const handle = moved ? gripCentre : Vec2.sub(gripCentre, running.translate);
    placeRef.current = { key: placeKey, pose, handle };
    if (!moved) return;

    const drawnAt = Vec2.add(last.handle, running.translate);
    const slide = Vec2.sub(drawnAt, handle);
    const drawnAngle = poseAngle(last.pose) + running.rotateDeg;
    const turn = drawnAngle - poseAngle(pose);
    const still = Math.abs(slide.x) < 0.5 && Math.abs(slide.y) < 0.5 && Math.abs(turn) < 0.5;
    if (still || prefersReducedMotion()) return;

    const barRect = bar.getBoundingClientRect();
    bar.style.transformOrigin = `${handle.x - barRect.left}px ${handle.y - barRect.top}px`;
    const sliding = springEasing(slideSpring(dragging));
    const turning = springEasing(TURN_SPRING);
    animationsRef.current = [
      bar.animate(
        { translate: [`${slide.x}px ${slide.y}px`, "0px 0px"] },
        { duration: sliding.duration, easing: sliding.easing },
      ),
      bar.animate(
        { rotate: [`${turn}deg`, "0deg"] },
        { duration: turning.duration, easing: turning.easing },
      ),
    ];
    if (last.pose !== pose) void dipTools(turning);
  });

  const grip = (
    <div
      ref={gripRef}
      role="presentation"
      title="Drag to move, double-click to flip"
      className={cn(
        "flex shrink-0 touch-none items-center justify-center rounded-md text-muted opacity-60 transition-opacity hover:opacity-100",
        vertical ? "h-5 w-9" : "h-9 w-5",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onPointerDown={onGripPointerDown}
    >
      <ShiftIcon name="drag-handle" className={cn("h-5.5 w-5.5", vertical && "rotate-90")} />
    </div>
  );
  const divider = (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 bg-hover",
        vertical ? "my-1.5 h-px self-stretch" : "mx-1.5 w-px self-stretch",
      )}
    />
  );
  const tools = (
    <div ref={toolsRef} className="flex min-w-0">
      <BarTools
        editor={editor}
        orientation={vertical ? "vertical" : "horizontal"}
        popupSide={POPUP_SIDE[slot ?? dock]}
      />
    </div>
  );

  return (
    <div className={cn("absolute", slot ? SLOT_FRAME[slot] : null)} style={followStyle}>
      {/*
        Unpositioned so the bar and its handle share this wrapper as offset parent, which
        lets `useToolbarDrag` subtract their offsets. `relative` would make the bar the
        handle's offset parent and skew the handle offset by the bar's position and border.
      */}
      <div
        ref={barRef}
        data-floating-toolbar=""
        className={cn(
          "pointer-events-auto flex items-center overflow-hidden rounded-xl border border-line-subtle bg-surface",
          vertical ? "w-12 flex-col py-1.5" : "h-12 flex-row px-1.5",
          "transition-[opacity,box-shadow] duration-150 ease-out",
          LIFT_CLASS[lift],
        )}
      >
        {tools}
        {divider}
        {grip}
      </div>
    </div>
  );
}
