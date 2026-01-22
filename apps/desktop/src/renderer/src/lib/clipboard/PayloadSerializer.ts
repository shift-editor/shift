import type { Rect2D } from "@shift/types";
import type { ClipboardContent, ClipboardPayload } from "./types";

export class PayloadSerializer {
  serialize(content: ClipboardContent, sourceGlyph?: string): string {
    const payload: ClipboardPayload = {
      version: 1,
      format: "shift/glyph-data",
      content,
      metadata: {
        bounds: this.#calculateBounds(content),
        sourceGlyph,
        timestamp: Date.now(),
      },
    };
    return JSON.stringify(payload);
  }

  tryDeserialize(text: string): ClipboardContent | null {
    try {
      const payload = JSON.parse(text);
      if (payload.format !== "shift/glyph-data") return null;
      if (payload.version > 1) return null;
      return payload.content;
    } catch {
      return null;
    }
  }

  #calculateBounds(content: ClipboardContent): Rect2D {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const contour of content.contours) {
      for (const point of contour.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }

    if (!isFinite(minX)) {
      return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
    };
  }
}
