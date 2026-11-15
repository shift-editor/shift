import { useRef } from "react";
import { Rect, type Point2D, type Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import { useDragAutoscroll } from "./useDragAutoscroll";
import { useGlyphSweep } from "./useGlyphSweep";

/**
 * Selecting by dragging a box from empty space. Boxes are in the container's
 * scrolled content, so one keeps its origin while the container scrolls.
 */
export interface GlyphBoxSelection {
  /** The glyphs a box touches, in grid order. */
  glyphsIn(box: Rect2D): readonly GlyphId[];
  /** Called with the box as it is dragged, and with null when the drag ends. */
  onChange(box: Rect2D | null): void;
}

/** A box drag under way: where it began, and the selection it adds to. */
interface BoxDrag {
  readonly origin: Point2D;
  readonly kept: GlyphSelection | null;
}

interface GlyphSelectionOptions {
  readonly selection: GlyphSelection;
  readonly onSelect: (selection: GlyphSelection) => void;
  /** The scrolling element the glyphs are drawn in, which a drag scrolls past its edges. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /** The glyph under a point in client pixels, or null over empty space. */
  readonly glyphAt: (clientX: number, clientY: number) => GlyphId | null;
  /** Takes the selected glyphs out on Delete or Backspace; absent where none can be. */
  readonly onRemove?: () => void;
  /** Copies the selected glyphs on ⌘C. */
  readonly onCopy: () => void;
  /** Glyphs per row, where the glyphs wrap into rows: Up and Down then move a row. */
  readonly columns?: number;
  /** Lets a drag from empty space select the glyphs its box touches. */
  readonly box?: GlyphBoxSelection;
  /** Whether a press at a point in client pixels is left alone, such as on a glyph's name. */
  readonly ignores?: (clientX: number, clientY: number) => boolean;
}

/** Handlers for a glyph grid: keys on the focusable container, pointer events on the surface. */
export interface GlyphSelectionHandlers {
  onKeyDown(event: React.KeyboardEvent): void;
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(): void;
  onLostPointerCapture(): void;
}

/**
 * Selects glyphs in a grid as a file list does: click to select, Shift-click
 * or drag for a range, ⌘-click to add or remove one, and with `box` a drag
 * from empty space selects what its box touches; the arrow keys move (Shift
 * extends), ⌘A selects all, ⌘C calls `onCopy`, Escape clears, and Delete
 * calls `onRemove`.
 */
export function useGlyphSelection({
  selection,
  onSelect,
  containerRef,
  glyphAt,
  onRemove,
  onCopy,
  columns,
  box,
  ignores,
}: GlyphSelectionOptions): GlyphSelectionHandlers {
  // non-reactive: the box drag under way, while the pointer is down.
  const boxDragRef = useRef<BoxDrag | null>(null);
  /** A point in client pixels as a point in the container's scrolled content. */
  const contentPoint = (clientX: number, clientY: number): Point2D | null => {
    const container = containerRef.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    return {
      x: clientX - bounds.left + container.scrollLeft,
      y: clientY - bounds.top + container.scrollTop,
    };
  };
  const boxDrag = useDragAutoscroll({
    containerRef,
    onDrag: (clientX, clientY) => {
      const drag = boxDragRef.current;
      const point = contentPoint(clientX, clientY);
      if (!drag || !point || !box) return;
      const dragged = Rect.fromXYWH(
        Math.min(drag.origin.x, point.x),
        Math.min(drag.origin.y, point.y),
        Math.abs(point.x - drag.origin.x),
        Math.abs(point.y - drag.origin.y),
      );
      box.onChange(dragged);
      onSelect(selection.box(box.glyphsIn(dragged), drag.kept));
    },
  });
  const endDrags = () => {
    sweep.end();
    boxDrag.end();
    if (boxDragRef.current) box?.onChange(null);
    boxDragRef.current = null;
  };

  const sweep = useGlyphSweep({
    containerRef,
    glyphAt,
    onSweep: (anchor, glyph) => onSelect(selection.drag(anchor, glyph)),
  });

  return {
    onKeyDown(event) {
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const betweenRows = event.key === "ArrowDown" || event.key === "ArrowUp";
      const distance = betweenRows ? (columns ?? 1) : 1;
      const remove = event.key === "Delete" || event.key === "Backspace";
      const command = event.metaKey || event.ctrlKey;
      if (forward || backward) {
        onSelect(selection.step(forward ? distance : -distance, event.shiftKey));
      } else if (event.key === "a" && command) {
        onSelect(selection.all());
      } else if (event.key === "c" && command && !selection.isEmpty) {
        onCopy();
      } else if (remove && onRemove && !selection.isEmpty) {
        onRemove();
      } else if (event.key === "Escape" && !selection.isEmpty) {
        onSelect(selection.clear());
      } else return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown(event) {
      if (event.button !== 0 || ignores?.(event.clientX, event.clientY)) return;
      const glyph = glyphAt(event.clientX, event.clientY);
      const modifiers = { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
      const modified = modifiers.range || modifiers.toggle;
      onSelect(selection.click(glyph, modifiers));
      const origin = glyph === null && box ? contentPoint(event.clientX, event.clientY) : null;
      if (origin) {
        // A drag from empty space boxes glyphs, added to the selection when modified.
        boxDragRef.current = { origin, kept: modified ? selection : null };
        event.currentTarget.setPointerCapture(event.pointerId);
        boxDrag.start(event.clientX, event.clientY);
        return;
      }
      // A drag from a plain press sweeps a range from where it started.
      if (!glyph || modified) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      sweep.start(glyph, event.clientX, event.clientY);
    },
    onPointerMove(event) {
      sweep.move(event.clientX, event.clientY);
      boxDrag.move(event.clientX, event.clientY);
    },
    onPointerUp: endDrags,
    onLostPointerCapture: endDrags,
  };
}
