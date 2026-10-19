import { useEffect, useRef } from "react";
import type { GlyphId } from "@shift/types";

/** How close to the container's top or bottom a drag starts scrolling it, in CSS pixels. */
const AUTOSCROLL_EDGE_PX = 12;
/** Scroll speed per pixel the pointer is past that edge, per frame, up to a maximum. */
const AUTOSCROLL_RATE = 0.4;
const AUTOSCROLL_MAX_PX = 16;

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
  // non-reactive: the dragging pointer in client pixels, for the autoscroll frame.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  // The autoscroll frame outlives renders, so it reads the latest callbacks through a ref.
  const latest = useRef({ glyphAt, onSweep });
  latest.current = { glyphAt, onSweep };

  const scroll = () => {
    const container = containerRef.current;
    const pointer = pointerRef.current;
    const anchor = anchorRef.current;
    if (!container || !pointer || !anchor) return;
    const bounds = container.getBoundingClientRect();
    const above = bounds.top + AUTOSCROLL_EDGE_PX - pointer.y;
    const below = pointer.y - (bounds.bottom - AUTOSCROLL_EDGE_PX);
    const reach = Math.max(above, below);
    if (reach > 0) {
      const speed = Math.min(reach * AUTOSCROLL_RATE, AUTOSCROLL_MAX_PX);
      container.scrollTop += above > 0 ? -speed : speed;
      const y = Math.min(Math.max(pointer.y, bounds.top + 1), bounds.bottom - 1);
      const glyph = latest.current.glyphAt(pointer.x, y);
      if (glyph) latest.current.onSweep(anchor, glyph);
    }
    frameRef.current = requestAnimationFrame(scroll);
  };

  const end = () => {
    anchorRef.current = null;
    pointerRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  useEffect(() => end, []);

  return {
    start(anchor, clientX, clientY) {
      anchorRef.current = anchor;
      pointerRef.current = { x: clientX, y: clientY };
      frameRef.current = requestAnimationFrame(scroll);
    },
    move(clientX, clientY) {
      const anchor = anchorRef.current;
      if (!anchor) return;
      pointerRef.current = { x: clientX, y: clientY };
      const glyph = glyphAt(clientX, clientY);
      if (glyph) onSweep(anchor, glyph);
    },
    end,
  };
}
