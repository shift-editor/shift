import type { GlyphId } from "@shift/types";
import type { GlyphSelection } from "./GlyphSelection";
import { useGlyphSweep } from "./useGlyphSweep";

interface GlyphSelectionOptions {
  readonly selection: GlyphSelection;
  readonly onSelect: (selection: GlyphSelection) => void;
  /** The scrolling element the glyphs are drawn in, which a drag scrolls past its edges. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /** The glyph under a point in client pixels, or null over empty space. */
  readonly glyphAt: (clientX: number, clientY: number) => GlyphId | null;
  /** Takes the selected glyphs out on Delete or Backspace; absent where none can be. */
  readonly onRemove?: () => void;
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
 * or drag for a range, ⌘-click to add or remove one; the arrow keys move
 * (Shift extends), ⌘A selects all, Escape clears, and Delete calls
 * `onRemove`.
 */
export function useGlyphSelection({
  selection,
  onSelect,
  containerRef,
  glyphAt,
  onRemove,
}: GlyphSelectionOptions): GlyphSelectionHandlers {
  const sweep = useGlyphSweep({
    containerRef,
    glyphAt,
    onSweep: (anchor, glyph) => onSelect(selection.drag(anchor, glyph)),
  });

  return {
    onKeyDown(event) {
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const remove = event.key === "Delete" || event.key === "Backspace";
      const command = event.metaKey || event.ctrlKey;
      if (forward || backward) {
        onSelect(selection.step(forward ? 1 : -1, event.shiftKey));
      } else if (event.key === "a" && command) {
        onSelect(selection.all());
      } else if (remove && onRemove && !selection.isEmpty) {
        onRemove();
      } else if (event.key === "Escape" && !selection.isEmpty) {
        onSelect(selection.clear());
      } else return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown(event) {
      if (event.button !== 0) return;
      const glyph = glyphAt(event.clientX, event.clientY);
      const modifiers = { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
      onSelect(selection.click(glyph, modifiers));
      // A drag from a plain press sweeps a range from where it started.
      if (!glyph || modifiers.range || modifiers.toggle) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      sweep.start(glyph, event.clientX, event.clientY);
    },
    onPointerMove(event) {
      sweep.move(event.clientX, event.clientY);
    },
    onPointerUp: sweep.end,
    onLostPointerCapture: sweep.end,
  };
}
