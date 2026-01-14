/**
 * Scene - Pure rendering from GlyphSnapshot.
 *
 * This class renders glyph data directly from Rust snapshots.
 * No intermediate TypeScript state - just snapshot in, path out.
 */

import { Path2D } from "@/lib/graphics/Path";
import { parseSegments } from "@/engine/segments";
import type { GlyphSnapshot, ContourSnapshot } from "@/types/generated";

// Debug logging
const DEBUG = true;
function debug(...args: any[]) {
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
  #snapshot: GlyphSnapshot | null = null;

  public constructor() {
    this.#staticGuides = new Path2D();
    this.#glyphPath = new Path2D();
  }

  /**
   * Set the current snapshot to render.
   */
  public setSnapshot(snapshot: GlyphSnapshot | null): void {
    debug("setSnapshot called:", snapshot ? `${snapshot.contours.length} contours` : "null");
    if (snapshot) {
      for (const contour of snapshot.contours) {
        debug("  Contour:", contour.id, "points:", contour.points.length, "closed:", contour.closed);
        for (const p of contour.points) {
          debug("    Point:", p.id, "x:", p.x, "y:", p.y, "type:", p.pointType);
        }
      }
    }
    this.#snapshot = snapshot;
    this.#glyphPath.invalidated = true;
  }

  /**
   * Get the current snapshot.
   */
  public getSnapshot(): GlyphSnapshot | null {
    return this.#snapshot;
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
   * The renderer (CanvasKitRenderer) uses the invalidated flag to know
   * when it needs to reconstruct its cached native path. The renderer
   * sets invalidated = false after it has processed the new commands.
   */
  public rebuildGlyphPath(): void {
    debug("rebuildGlyphPath called, invalidated:", this.#glyphPath.invalidated);

    if (!this.#glyphPath.invalidated) {
      debug("  Path not invalidated, skipping rebuild");
      return;
    }

    this.#glyphPath.clear();

    if (!this.#snapshot) {
      debug("  No snapshot, returning empty path");
      // Still need to keep invalidated = true so renderer clears its cache
      return;
    }

    debug("  Building path from", this.#snapshot.contours.length, "contours");
    for (const contour of this.#snapshot.contours) {
      this.#buildContourPath(contour);
    }

    // Note: We intentionally leave invalidated = true here.
    // The renderer will set it to false after reconstructing its native path.
    debug("  Path built with", this.#glyphPath.commands.length, "commands, leaving invalidated=true for renderer");
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
}
