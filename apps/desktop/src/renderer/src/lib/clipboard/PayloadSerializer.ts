import type { Rect2D } from "@shift/types";
import { Polygon } from "@shift/geo";
import { ValidateClipboard } from "@shift/validation";
import type { ClipboardContent, ClipboardPayload } from "./types";

const EMPTY_BOUNDS: Rect2D = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

export class PayloadSerializer {
  serialize(content: ClipboardContent, sourceGlyph?: string): string {
    const payload: ClipboardPayload = {
      version: 1,
      format: "shift/glyph-data",
      content,
      metadata: {
        bounds: this.calculateBounds(content),
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
      if (!ValidateClipboard.isClipboardContent(payload.content)) return null;
      return payload.content;
    } catch {
      return null;
    }
  }

  calculateBounds(content: ClipboardContent): Rect2D {
    const points = content.contours.flatMap((c) => c.points);
    return Polygon.boundingRect(points) ?? EMPTY_BOUNDS;
  }
}
