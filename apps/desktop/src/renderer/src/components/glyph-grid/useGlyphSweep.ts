import { useRef } from "react";
import type { GlyphId } from "@shift/types";
import { useDragAutoscroll } from "./useDragAutoscroll";

interface GlyphSweepOptions {
  /** The scrolling element the glyphs are drawn in. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /** The glyph under a point in client pixels, or null over empty space. */
  readonly glyphAt: (clientX: number, clientY: number) => GlyphId | null;
  /** Called as the drag sweeps from `anchor` to `glyph`. */
  readonly onSweep: (anchor: GlyphId, glyph: GlyphId) => void;
}

/** A sweep across the glyphs, started on one with {@link GlyphSweep.start}. */
export interface GlyphSweep {
  start(anchor: GlyphId, clientX: number, clientY: number): void;
  /** Follows the pointer; does nothing when no drag is under way. */
  move(clientX: number, clientY: number): void;
  end(): void;
}

/**
 * A drag that sweeps a range of glyphs, scrolling the container each frame
 * while the pointer is held past its top or bottom and extending the sweep
 * to the glyph at the nearest visible edge.
 */
export function useGlyphSweep({ containerRef, glyphAt, onSweep }: GlyphSweepOptions): GlyphSweep {
  // non-reactive: the glyph the drag started on, while the pointer is down.
  const anchorRef = useRef<GlyphId | null>(null);
  const drag = useDragAutoscroll({
    containerRef,
    onDrag: (clientX, clientY) => {
      const anchor = anchorRef.current;
      const glyph = glyphAt(clientX, clientY);
      if (anchor && glyph) onSweep(anchor, glyph);
    },
  });

  return {
    start(anchor, clientX, clientY) {
      anchorRef.current = anchor;
      drag.start(clientX, clientY);
    },
    move: drag.move,
    end() {
      anchorRef.current = null;
      drag.end();
    },
  };
}
