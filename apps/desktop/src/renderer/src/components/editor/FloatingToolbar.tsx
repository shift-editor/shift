import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@shift/ui";
import { ToolsPane, type ToolsPaneSide } from "@shift/editor/ui";
import DragHandleSvg from "@assets/toolbar/drag-handle.svg";
import { useEditor } from "@/workspace/WorkspaceContext";

// SPIKE: floating tools that snap to an edge of the canvas panel. Positions are
// relative to the panel so the bar follows the canvas as sidebars open and close.

type Dock = "top" | "bottom" | "left" | "right";

const DOCKS: readonly Dock[] = ["bottom", "top", "left", "right"];
const DOCK_STORAGE_KEY = "shift:floating-toolbar-dock";
const POPUP_SIDE: Record<Dock, ToolsPaneSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};
// Each slot is a strip along its edge that centres the bar with flex, so the bar
// itself carries no percentage translate for Motion's layout animation to fight.
const SLOT_FRAME: Record<Dock, string> = {
  top: "inset-x-3 top-3 flex justify-center",
  bottom: "inset-x-3 bottom-3 flex justify-center",
  left: "inset-y-3 left-3 flex flex-col justify-center",
  right: "inset-y-3 right-3 flex flex-col justify-center",
};
const DROP_ZONE_POSITION: Record<Dock, string> = {
  top: "inset-x-3 top-3 h-12",
  bottom: "inset-x-3 bottom-3 h-12",
  left: "inset-y-3 left-3 w-12",
  right: "inset-y-3 right-3 w-12",
};

/** Bar thickness across its tools, in either orientation. */
const BAR_THICKNESS = 48;
/** How close the bar must come to an edge to snap onto it. */
const SNAP_DISTANCE = 96;
/** How far a snapped bar must pull away from its edge before it comes loose. */
const RELEASE_DISTANCE = 128;
/**
 * How much closer another edge must be before the bar switches to it, so it
 * does not flicker between two edges near a corner.
 */
const SWITCH_MARGIN = 24;
/**
 * Pulled onto an edge mid-drag: quick and without bounce, since the pointer is
 * still moving and a wobble there reads as jitter.
 */
const MAGNET_TRANSITION: Transition = {
  type: "spring",
  visualDuration: 0.16,
  bounce: 0,
};
/** Pulled off an edge mid-drag: catches up with the pointer almost at once. */
const DETACH_TRANSITION: Transition = {
  type: "spring",
  visualDuration: 0.1,
  bounce: 0,
};
/** Dropped onto an edge: a little longer, landing with a small bump. */
const DROP_TRANSITION: Transition = {
  type: "spring",
  visualDuration: 0.22,
  bounce: 0.15,
};

/**
 * Turning between a row and a column crossfades: the old bar fades out where it
 * is while the new one scales in at its edge. Any shape between a row and a
 * column reads as a stray box, so the bar never passes through one. A slight
 * blur on both bars blends the swap into one change instead of two bars
 * trading places. Scale is a full transform string so it runs off the main
 * thread while the canvas is busy.
 */
const CROSSFADE_SCALE = "scale(0.95)";
const CROSSFADE_BLUR = "blur(2px)";
/** Strong ease-out; ease-in would hold the old bar just as the eye looks at it. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/**
 * The landing preview fades and grows in very slightly rather than popping, and
 * leaves a little faster than it arrives.
 */
const PREVIEW_SCALE = "scale(0.98)";
const PREVIEW_IN_TRANSITION: Transition = { duration: 0.15, ease: EASE_OUT };
const PREVIEW_OUT_TRANSITION: Transition = { duration: 0.1, ease: EASE_OUT };
const CROSSFADE_OUT_TRANSITION: Transition = { duration: 0.1, ease: EASE_OUT };
const CROSSFADE_IN_TRANSITION: Transition = {
  transform: { type: "spring", visualDuration: 0.22, bounce: 0.1 },
  opacity: { duration: 0.13, ease: EASE_OUT },
  filter: { duration: 0.13, ease: EASE_OUT },
};

interface DragState {
  /** Bar's top-left corner inside the canvas panel while it follows the pointer. */
  left: number;
  top: number;
  /** Edge where the bar lands on release, whose orientation the bar takes straight away. */
  target: Dock;
  /** Whether the bar sits in `target`'s slot rather than following the pointer. */
  snapped: boolean;
  /** Bar length along its tools, measured when the drag began. */
  length: number;
}

function readDock(): Dock {
  try {
    const stored = localStorage.getItem(DOCK_STORAGE_KEY);
    return DOCKS.find((dock) => dock === stored) ?? "bottom";
  } catch {
    return "bottom";
  }
}

function writeDock(dock: Dock): void {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, dock);
  } catch {
    // Remembering the dock is a convenience; the bar works without it.
  }
}

function isVertical(dock: Dock): boolean {
  return dock === "left" || dock === "right";
}

/**
 * Pointer offset from the bar's top-left corner that puts the grip, at the far
 * end of the bar, under the pointer.
 */
function gripOffset(dock: Dock, length: number): { x: number; y: number } {
  const alongBar = length - 16;
  return isVertical(dock) ? { x: 24, y: alongBar } : { x: alongBar, y: 24 };
}

/**
 * Picks where a dragged bar goes. The edge is chosen by the pointer, which the
 * bar's shape cannot affect; choosing by the bar's body would loop, because the
 * bar turns to suit its edge and turning moves its ends by hundreds of pixels.
 * Whether it snaps is judged by the bar's body, already turned for that edge.
 */
function nextDrag(previous: DragState, x: number, y: number, layer: DOMRect): DragState {
  const pointerDistances = edgeDistances(x, y, 0, 0, layer);
  const nearest = DOCKS.reduce((best, next) =>
    pointerDistances[next] < pointerDistances[best] ? next : best,
  );
  const keepTarget = pointerDistances[previous.target] <= pointerDistances[nearest] + SWITCH_MARGIN;
  const target = keepTarget ? previous.target : nearest;

  const offset = gripOffset(target, previous.length);
  const left = x - offset.x;
  const top = y - offset.y;
  const vertical = isVertical(target);
  const width = vertical ? BAR_THICKNESS : previous.length;
  const height = vertical ? previous.length : BAR_THICKNESS;
  const barDistance = edgeDistances(left, top, width, height, layer)[target];
  const holding = previous.snapped && previous.target === target;
  const snapped = barDistance <= (holding ? RELEASE_DISTANCE : SNAP_DISTANCE);
  return { ...previous, left, top, target, snapped };
}

/** Gap between each canvas edge and a box with its top-left corner at `left`, `top`. */
function edgeDistances(
  left: number,
  top: number,
  width: number,
  height: number,
  layer: DOMRect,
): Record<Dock, number> {
  return {
    top,
    bottom: layer.height - (top + height),
    left,
    right: layer.width - (left + width),
  };
}

/** Picks the spring for whatever moved the bar into or out of a slot. */
function slotTransition(dragging: boolean, snapped: boolean, reduceMotion: boolean): Transition {
  if (!dragging) return reduceMotion ? { ...DROP_TRANSITION, bounce: 0 } : DROP_TRANSITION;
  return snapped ? MAGNET_TRANSITION : DETACH_TRANSITION;
}

function snappedSlot(drag: DragState): Dock | null {
  return drag.snapped ? drag.target : null;
}

export const FloatingToolbar = () => {
  const editor = useEditor();
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dock, setDock] = useState<Dock>(readDock);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragging = drag !== null;

  // Track the drag on the window so it always ends, even when the pointer leaves
  // the grip, the window loses focus, or the browser cancels the gesture.
  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const layer = layerRef.current?.getBoundingClientRect();
      const previous = dragRef.current;
      if (!layer || !previous) return;
      const next = nextDrag(previous, event.clientX - layer.left, event.clientY - layer.top, layer);
      dragRef.current = next;
      setDrag(next);
    };
    const drop = () => {
      const target = dragRef.current?.target;
      dragRef.current = null;
      setDrag(null);
      if (!target) return;
      setDock(target);
      writeDock(target);
    };
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [dragging]);

  const onGripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const layer = layerRef.current?.getBoundingClientRect();
    const bar = event.currentTarget.closest<HTMLElement>("[data-floating-toolbar]");
    if (event.button !== 0 || !layer || !bar) return;
    event.preventDefault();
    const start = nextDrag(
      {
        left: 0,
        top: 0,
        target: dock,
        snapped: true,
        length: Math.max(bar.offsetWidth, bar.offsetHeight),
      },
      event.clientX - layer.left,
      event.clientY - layer.top,
      layer,
    );
    dragRef.current = start;
    setDrag(start);
  };

  // The bar sits in a dock slot when it is docked or snapped mid-drag, and
  // follows the pointer otherwise, already turned to suit the edge it is heading for.
  const slot = drag ? snappedSlot(drag) : dock;
  const vertical = isVertical(drag?.target ?? dock);
  // Motion animates the bar's position only when it enters or leaves a slot;
  // while it follows the pointer it moves with no animation.
  const layoutDependency = slot ?? "free";
  const followStyle = drag && !slot ? { left: drag.left, top: drag.top } : {};
  const orientation = vertical ? "vertical" : "horizontal";
  // With reduced motion the bars only fade; nothing grows or shrinks.
  const reduceMotion = useReducedMotion();
  const previewHidden = {
    opacity: 0,
    transform: reduceMotion ? "none" : PREVIEW_SCALE,
  };
  const crossfadeHidden = {
    opacity: 0,
    transform: reduceMotion ? "none" : CROSSFADE_SCALE,
    filter: CROSSFADE_BLUR,
  };

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
      {/*
        The landing preview fades in on grab, and crossfades to the next edge as
        the target changes, so it never jumps from one edge to another.
      */}
      <AnimatePresence>
        {drag ? (
          <motion.div
            key={`zone-${drag.target}`}
            aria-hidden="true"
            initial={previewHidden}
            animate={{
              opacity: 1,
              transform: "scale(1)",
              transition: PREVIEW_IN_TRANSITION,
            }}
            exit={{ ...previewHidden, transition: PREVIEW_OUT_TRANSITION }}
            // Deepens once the bar has snapped, confirming it caught.
            className={cn(
              "absolute rounded-xl transition-colors duration-150",
              drag.snapped ? "bg-accent/10" : "bg-accent/5",
              DROP_ZONE_POSITION[drag.target],
            )}
          />
        ) : null}
        {drag ? (
          // Outlines exactly where the bar will sit, sized for that edge's orientation.
          <motion.div
            key={`slot-${drag.target}`}
            aria-hidden="true"
            initial={previewHidden}
            animate={{
              opacity: 1,
              transform: "scale(1)",
              transition: PREVIEW_IN_TRANSITION,
            }}
            exit={{ ...previewHidden, transition: PREVIEW_OUT_TRANSITION }}
            className={cn("absolute", SLOT_FRAME[drag.target])}
          >
            <div
              className="rounded-xl border-2 border-dashed border-accent/60 bg-accent/10"
              style={
                isVertical(drag.target)
                  ? { width: BAR_THICKNESS, height: drag.length }
                  : { width: drag.length, height: BAR_THICKNESS }
              }
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {/*
        Each orientation is its own bar, so turning crossfades between two bars.
        The leaving bar keeps its last frame and position while it fades out.
      */}
      <AnimatePresence initial={false}>
        <motion.div
          key={orientation}
          initial={crossfadeHidden}
          animate={{
            opacity: 1,
            transform: "scale(1)",
            filter: "blur(0px)",
            transition: CROSSFADE_IN_TRANSITION,
            // Nothing left on the bar at rest, so its text and icons stay crisp.
            transitionEnd: { transform: "none", filter: "none" },
          }}
          exit={{
            ...crossfadeHidden,
            pointerEvents: "none",
            transition: CROSSFADE_OUT_TRANSITION,
          }}
          className={cn("absolute", slot ? SLOT_FRAME[slot] : null)}
          style={followStyle}
        >
          <motion.div
            data-floating-toolbar=""
            layout
            layoutDependency={layoutDependency}
            transition={slotTransition(dragging, slot !== null, reduceMotion ?? false)}
            style={{ borderRadius: 12 }}
            className={cn(
              "pointer-events-auto flex items-center overflow-hidden border border-line-subtle bg-surface",
              vertical ? "w-12 flex-col py-1.5" : "h-12 flex-row px-1.5",
              drag ? "shadow-xl" : "card-shadow",
            )}
          >
            <ToolsPane
              editor={editor}
              orientation={orientation}
              popupSide={POPUP_SIDE[slot ?? dock]}
              variant="floating"
            />
            <div
              aria-hidden="true"
              className={cn(
                "shrink-0 bg-hover",
                vertical ? "my-1.5 h-px self-stretch" : "mx-1.5 w-px self-stretch",
              )}
            />
            <div
              role="presentation"
              title="Drag to move"
              className={cn(
                "flex shrink-0 touch-none items-center justify-center rounded-md text-muted opacity-60 transition-opacity hover:opacity-100",
                vertical ? "h-5 w-9" : "h-9 w-5",
                drag ? "cursor-grabbing" : "cursor-grab",
              )}
              onPointerDown={onGripPointerDown}
            >
              <DragHandleSvg width={22} height={22} className={cn(vertical && "rotate-90")} />
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
