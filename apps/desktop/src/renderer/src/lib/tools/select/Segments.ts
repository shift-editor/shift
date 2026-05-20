import type { Segment } from "@shift/glyph-state";
import type { GlyphInstanceGeometry } from "@/lib/model/Glyph";
import type { Hover } from "@/lib/editor/Hover";
import type { Selection } from "@/lib/editor/Selection";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { Segments as SegmentOverlay } from "@/lib/editor/rendering/overlays";

export class SelectSegments {
  readonly #overlay = new SegmentOverlay();
  readonly #selected: Segment[] = [];

  draw(
    canvas: Canvas,
    geometry: GlyphInstanceGeometry,
    selection: Selection,
    hover: Hover,
  ): void {
    this.#selected.length = 0;

    for (const segmentId of selection.segmentIds) {
      const segment = geometry.segment(segmentId);
      if (segment) this.#selected.push(segment);
    }

    this.#overlay.draw(
      canvas,
      this.#hoveredSegment(geometry, hover),
      this.#selected,
    );
  }

  #hoveredSegment(
    geometry: GlyphInstanceGeometry,
    hover: Hover,
  ): Segment | null {
    const segmentId = hover.segmentId;
    if (!segmentId) return null;

    return geometry.segment(segmentId);
  }
}
