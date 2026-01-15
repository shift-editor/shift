/**
 * Scene - Pure rendering from GlyphSnapshot with reactive invalidation.
 *
 * Uses signals to automatically track when paths need rebuilding.
 * The snapshot signal triggers path rebuilding when it changes.
 */

import { Path2D } from "@/lib/graphics/Path";
import { signal, computed, effect, type Effect, type WritableSignal, type ComputedSignal } from "@/lib/reactive/signal";
import { parseSegments } from "@/engine/segments";
import type { GlyphSnapshot, ContourSnapshot } from "@/types/generated";

// Debug logging
const DEBUG = false;
function debug(...args: unknown[]) {
  if (DEBUG) console.log("[Scene]", ...args);
}

export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

export class Scene {
  #staticGuides: Path2D;
  #glyphPath: Path2D;

  // Reactive state
  readonly snapshot: WritableSignal<GlyphSnapshot | null>;
  readonly needsRebuild: ComputedSignal<boolean>;

  // Track the last snapshot we built from (for change detection)
  #lastBuiltSnapshot: GlyphSnapshot | null = null;

  public constructor() {
    this.#staticGuides = new Path2D();
    this.#glyphPath = new Path2D();

    // Reactive snapshot - setting this triggers path invalidation
    this.snapshot = signal<GlyphSnapshot | null>(null);

    // Computed that tracks whether we need to rebuild
    // This is true when snapshot changes from what we last built
    this.needsRebuild = computed(() => {
      const current = this.snapshot.value;
      return current !== this.#lastBuiltSnapshot;
    });
  }

  /**
   * Set the current snapshot to render.
   * This automatically invalidates the glyph path.
   */
  public setSnapshot(snapshot: GlyphSnapshot | null): void {
    debug("setSnapshot called:", snapshot ? `${snapshot.contours.length} contours` : "null");
    this.snapshot.set(snapshot);
    this.#glyphPath.invalidated = true;
  }

  /**
   * Get the current snapshot.
   */
  public getSnapshot(): GlyphSnapshot | null {
    return this.snapshot.value;
  }

  public constructGuidesPath(guides: Guides): Path2D {
    this.#staticGuides.clear();

    // Draw horizontal guide lines
    this.#staticGuides.moveTo(0, guides.ascender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.ascender.y);

    this.#staticGuides.moveTo(0, guides.capHeight.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.capHeight.y);

    this.#staticGuides.moveTo(0, guides.xHeight.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.xHeight.y);

    this.#staticGuides.moveTo(0, guides.baseline.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.baseline.y);

    this.#staticGuides.moveTo(0, guides.descender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.descender.y);

    // Draw vertical guide lines
    this.#staticGuides.moveTo(0, guides.descender.y);
    this.#staticGuides.lineTo(0, guides.ascender.y);
    this.#staticGuides.moveTo(guides.xAdvance, guides.descender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.ascender.y);

    return this.#staticGuides;
  }

  public getGuidesPath(): Path2D {
    return this.#staticGuides;
  }

  public getGlyphPath(): Path2D {
    this.rebuildGlyphPath();
    return this.#glyphPath;
  }

  /**
   * Rebuild the glyph path from the current snapshot.
   *
   * Note: We do NOT set invalidated = false here.
   * The renderer uses the invalidated flag to know when it needs to
   * reconstruct its cached native path. The renderer sets invalidated
   * = false after it has processed the new commands.
   */
  public rebuildGlyphPath(): void {
    debug("rebuildGlyphPath called, invalidated:", this.#glyphPath.invalidated);

    if (!this.#glyphPath.invalidated) {
      debug("  Path not invalidated, skipping rebuild");
      return;
    }

    this.#glyphPath.clear();

    const snapshot = this.snapshot.value;
    if (!snapshot) {
      debug("  No snapshot, returning empty path");
      return;
    }

    debug("  Building path from", snapshot.contours.length, "contours");
    for (const contour of snapshot.contours) {
      this.#buildContourPath(contour);
    }

    // Update tracking
    this.#lastBuiltSnapshot = snapshot;

    debug("  Path built with", this.#glyphPath.commands.length, "commands");
  }

  #buildContourPath(contour: ContourSnapshot): void {
    debug("  #buildContourPath:", contour.id, "points:", contour.points.length);

    if (contour.points.length < 2) {
      debug("    Less than 2 points, skipping");
      return;
    }

    const segments = parseSegments(contour.points, contour.closed);
    debug("    parseSegments returned", segments.length, "segments");

    if (segments.length === 0) {
      debug("    No segments, returning");
      return;
    }

    // Move to the first point
    debug("    moveTo:", segments[0].points.anchor1.x, segments[0].points.anchor1.y);
    this.#glyphPath.moveTo(
      segments[0].points.anchor1.x,
      segments[0].points.anchor1.y
    );

    // Draw each segment
    for (const segment of segments) {
      switch (segment.type) {
        case "line":
          debug("    lineTo:", segment.points.anchor2.x, segment.points.anchor2.y);
          this.#glyphPath.lineTo(
            segment.points.anchor2.x,
            segment.points.anchor2.y
          );
          break;
        case "quad":
          debug("    quadTo:", segment.points.control.x, segment.points.control.y, "->", segment.points.anchor2.x, segment.points.anchor2.y);
          this.#glyphPath.quadTo(
            segment.points.control.x,
            segment.points.control.y,
            segment.points.anchor2.x,
            segment.points.anchor2.y
          );
          break;
        case "cubic":
          debug("    cubicTo:", segment.points.control1.x, segment.points.control1.y, "->", segment.points.control2.x, segment.points.control2.y, "->", segment.points.anchor2.x, segment.points.anchor2.y);
          this.#glyphPath.cubicTo(
            segment.points.control1.x,
            segment.points.control1.y,
            segment.points.control2.x,
            segment.points.control2.y,
            segment.points.anchor2.x,
            segment.points.anchor2.y
          );
          break;
      }
    }

    if (contour.closed) {
      debug("    closePath");
      this.#glyphPath.closePath();
    }
  }

  public invalidateGlyph(): void {
    this.#glyphPath.invalidated = true;
  }

  /**
   * Create an effect that runs when the snapshot changes.
   * Useful for the Editor to trigger redraws.
   *
   * @example
   * const cleanup = scene.onSnapshotChange(() => {
   *   editor.requestRedraw();
   * });
   */
  public onSnapshotChange(callback: () => void): Effect {
    return effect(() => {
      this.snapshot.value; // Subscribe to changes
      callback();
    });
  }
}
