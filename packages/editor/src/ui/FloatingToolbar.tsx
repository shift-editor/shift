import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@shift/ui";
import type { Editor } from "../lib/editor/Editor";
import { ShiftIcon } from "./ShiftIcon";
import { springEasing, type Spring } from "./springEasing";
import { ToolsPane, type ToolsPaneSide } from "./ToolsPane";

type Dock = "top" | "bottom" | "left" | "right";
type Orientation = "horizontal" | "vertical";

const DOCKS: readonly Dock[] = ["bottom", "top", "left", "right"];
const DOCK_STORAGE_KEY = "shift:floating-toolbar-dock";
const POPUP_SIDE: Record<Dock, ToolsPaneSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};
// Each slot is a strip along its edge that centres the bar with flex, so the bar
// itself carries no percentage translate for its slide animation to fight.
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
const MAGNET_SPRING: Spring = { visualDuration: 0.16, bounce: 0 };
/** Pulled off an edge mid-drag: catches up with the pointer almost at once. */
const DETACH_SPRING: Spring = { visualDuration: 0.1, bounce: 0 };
/** Dropped onto an edge: a little longer, landing with a small bump. */
const DROP_SPRING: Spring = { visualDuration: 0.22, bounce: 0.15 };

/** Strong ease-out; ease-in would hold the old bar just as the eye looks at it. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/**
 * Turning between a row and a column crossfades: the old bar fades out where it
 * is while the new one scales in at its edge. Any shape between a row and a
 * column reads as a stray box, so the bar never passes through one. A slight
 * blur on both bars blends the swap into one change instead of two bars
 * trading places.
 */
const CROSSFADE_SCALE = "scale(0.95)";
const CROSSFADE_BLUR = "blur(2px)";
const CROSSFADE_IN_SPRING: Spring = { visualDuration: 0.22, bounce: 0.1 };
const CROSSFADE_IN_FADE_MS = 130;
const CROSSFADE_OUT_MS = 100;
/** The landing preview fades and grows in very slightly rather than popping. */
const PREVIEW_STYLE: CSSProperties = { transitionTimingFunction: EASE_OUT };

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
function slotSpring(dragging: boolean, snapped: boolean): Spring {
  if (!dragging) return prefersReducedMotion() ? { ...DROP_SPRING, bounce: 0 } : DROP_SPRING;
  return snapped ? MAGNET_SPRING : DETACH_SPRING;
}

function snappedSlot(drag: DragState): Dock | null {
  return drag.snapped ? drag.target : null;
}

/** With reduced motion the bar only fades; nothing slides past, grows, or bounces. */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How far a running slide animation has shifted the element from its laid-out place. */
function slideOffset(element: HTMLElement): { x: number; y: number } {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/** Everything that places one bar, kept so a leaving bar can stay put while it fades. */
interface BarFrame {
  orientation: Orientation;
  /** Edge slot the bar sits in, or null while it follows the pointer. */
  slot: Dock | null;
  followStyle: CSSProperties;
  popupSide: ToolsPaneSide;
  dragging: boolean;
}

interface BarProps {
  editor: Editor;
  frame: BarFrame;
  /** Scales and fades the bar in when it mounts, after the toolbar's first render. */
  animateIn: boolean;
  /** Fades the bar out where it is, then calls `onExited`. */
  leaving?: boolean;
  onExited?: () => void;
  onGripPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * One bar in one orientation. It slides when it enters or leaves a slot, and
 * fades with a slight scale and blur as it appears or leaves.
 */
function Bar({ editor, frame, animateIn, leaving = false, onExited, onGripPointerDown }: BarProps) {
  const { orientation, slot, followStyle, popupSide, dragging } = frame;
  const vertical = orientation === "vertical";
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{ left: number; top: number } | null>(null);
  const placeRef = useRef(slot ?? "free");
  const slideRef = useRef<Animation | null>(null);

  // Only a bar that mounts after the toolbar's first render crossfades in.
  const animateInRef = useRef(animateIn && !leaving);
  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element || !animateInRef.current) return;
    const fade = { duration: CROSSFADE_IN_FADE_MS, easing: EASE_OUT };
    element.animate({ opacity: [0, 1], filter: [CROSSFADE_BLUR, "blur(0px)"] }, fade);
    if (prefersReducedMotion()) return;
    const { easing, duration } = springEasing(CROSSFADE_IN_SPRING);
    element.animate({ transform: [CROSSFADE_SCALE, "none"] }, { duration, easing });
  }, []);

  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element || !leaving) return;
    const transform = prefersReducedMotion() ? "none" : CROSSFADE_SCALE;
    const exit = element.animate(
      { opacity: [1, 0], transform: ["none", transform], filter: ["blur(0px)", CROSSFADE_BLUR] },
      { duration: CROSSFADE_OUT_MS, easing: EASE_OUT, fill: "forwards" },
    );
    exit.onfinish = () => onExited?.();
    return () => exit.cancel();
  }, [leaving, onExited]);

  // Slides the bar from where it was drawn to its new place whenever it enters
  // or leaves a slot. While it follows the pointer it moves with no animation.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const offset = slideOffset(bar);
    const rect = bar.getBoundingClientRect();
    const layout = { left: rect.left - offset.x, top: rect.top - offset.y };
    const previous = layoutRef.current;
    const place = slot ?? "free";
    const moved = place !== placeRef.current;
    layoutRef.current = layout;
    placeRef.current = place;
    if (!moved || !previous || leaving) return;

    slideRef.current?.cancel();
    const dx = previous.left + offset.x - layout.left;
    const dy = previous.top + offset.y - layout.top;
    if (dx === 0 && dy === 0) return;
    const { easing, duration } = springEasing(slotSpring(dragging, slot !== null));
    slideRef.current = bar.animate(
      { transform: [`translate(${dx}px, ${dy}px)`, "none"] },
      { duration, easing },
    );
  });

  return (
    <div
      ref={frameRef}
      inert={leaving}
      aria-hidden={leaving || undefined}
      className={cn("absolute", slot ? SLOT_FRAME[slot] : null, leaving && "pointer-events-none")}
      style={followStyle}
    >
      <div
        ref={barRef}
        data-floating-toolbar=""
        className={cn(
          "pointer-events-auto flex items-center overflow-hidden rounded-xl border border-line-subtle bg-surface",
          vertical ? "w-12 flex-col py-1.5" : "h-12 flex-row px-1.5",
          dragging ? "shadow-xl" : "card-shadow",
        )}
      >
        <ToolsPane editor={editor} orientation={orientation} popupSide={popupSide} />
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
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerDown={onGripPointerDown}
        >
          <ShiftIcon name="drag-handle" className={cn("h-5.5 w-5.5", vertical && "rotate-90")} />
        </div>
      </div>
    </div>
  );
}

export interface FloatingToolbarProps {
  editor: Editor;
}

/**
 * Renders the editor's tools as a bar floating over the canvas, docked to an
 * edge the user picks by dragging its grip.
 *
 * @remarks
 * Place it inside the canvas container, which must be positioned: the bar
 * fills that container as an overlay and docks against its edges, so it
 * follows the canvas as surrounding panels resize. The chosen edge is
 * remembered in `localStorage` when storage is available.
 */
export function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dock, setDock] = useState<Dock>(readDock);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Keeps the outline's size while it fades out after a drop.
  const [previewLength, setPreviewLength] = useState(0);
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
    setPreviewLength(start.length);
  };

  // The bar sits in a dock slot when it is docked or snapped mid-drag, and
  // follows the pointer otherwise, already turned to suit the edge it is heading for.
  const slot = drag ? snappedSlot(drag) : dock;
  const frame: BarFrame = {
    orientation: isVertical(drag ? drag.target : dock) ? "vertical" : "horizontal",
    slot,
    followStyle: drag && !slot ? { left: drag.left, top: drag.top } : {},
    popupSide: POPUP_SIDE[slot ?? dock],
    dragging,
  };

  // Turning swaps in a bar for the new orientation; the last bar of the old
  // one stays where it was and fades out.
  const lastFrameRef = useRef(frame);
  const [leavingFrame, setLeavingFrame] = useState<BarFrame | null>(null);
  useLayoutEffect(() => {
    if (lastFrameRef.current.orientation !== frame.orientation) {
      setLeavingFrame(lastFrameRef.current);
    }
    lastFrameRef.current = frame;
  });
  // The first bar appears without animating; later ones crossfade in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const clearLeaving = useCallback(() => setLeavingFrame(null), []);
  const outlineLength = drag ? drag.length : previewLength;

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
        A landing preview for every edge stays mounted and fades with CSS, so
        it fades in on grab, crossfades as the target edge changes, and fades
        out on drop.
      */}
      {DOCKS.map((edge) => {
        const shown = drag !== null && drag.target === edge;
        return (
          <Fragment key={edge}>
            <div
              aria-hidden="true"
              style={PREVIEW_STYLE}
              className={cn(
                "absolute rounded-xl transition duration-150 motion-reduce:scale-100",
                // Deepens once the bar has snapped, confirming it caught.
                shown && drag.snapped ? "bg-accent/10" : "bg-accent/5",
                shown ? "scale-100 opacity-100" : "scale-98 opacity-0",
                DROP_ZONE_POSITION[edge],
              )}
            />
            {/* Outlines exactly where the bar will sit, sized for that edge's orientation. */}
            <div aria-hidden="true" className={cn("absolute", SLOT_FRAME[edge])}>
              <div
                style={{
                  ...PREVIEW_STYLE,
                  width: isVertical(edge) ? BAR_THICKNESS : outlineLength,
                  height: isVertical(edge) ? outlineLength : BAR_THICKNESS,
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
      {leavingFrame ? (
        <Bar
          key={`leaving-${leavingFrame.orientation}`}
          editor={editor}
          frame={leavingFrame}
          animateIn={false}
          leaving
          onExited={clearLeaving}
        />
      ) : null}
      <Bar
        key={frame.orientation}
        editor={editor}
        frame={frame}
        animateIn={mounted}
        onGripPointerDown={onGripPointerDown}
      />
    </div>
  );
}
