import type { Rect2D } from "@shift/geo";
import { Polygon } from "@shift/geo";
import { ValidateClipboard } from "@shift/validation";
import type {
  SystemClipboard,
  ClipboardImporter,
  ClipboardOffer,
  ClipboardPayload,
  ClipboardReadResult,
  ClipboardWriteMetadata,
  ShiftContent,
} from "./types";
import { SvgImporter } from "./importers/SvgImporter";

const DEFAULT_PASTE_OFFSET = 20;

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

interface ClipboardState {
  content: ShiftContent | null;
  bounds: Rect2D | null;
  timestamp: number;
}

/**
 * Clipboard owns OS clipboard IO, serialization, and external format parsing.
 * It returns glyph content to callers; Editor decides how that content mutates
 * the active source.
 */
export class Clipboard {
  readonly #system: SystemClipboard;
  readonly #importers: ClipboardImporter[] = [];
  #internalState: ClipboardState = {
    content: null,
    bounds: null,
    timestamp: 0,
  };
  #pasteCount = 0;

  constructor(system: SystemClipboard) {
    this.#system = system;
    this.#importers.push(new SvgImporter());
  }

  async write(content: ShiftContent, metadata: ClipboardWriteMetadata = {}): Promise<boolean> {
    if (!content || content.contours.length === 0) return false;

    const bounds = Polygon.boundingRect(content.contours.flatMap((c) => c.points)) ?? EMPTY_BOUNDS;
    this.#internalState = { content, bounds, timestamp: Date.now() };
    this.#pasteCount = 0;

    try {
      const payload: ClipboardPayload = {
        version: 1,
        format: "shift/glyph-data",
        content,
        metadata: {
          bounds,
          timestamp: Date.now(),
          sourceApp: "shift",
          ...(metadata.sourceGlyph ? { sourceGlyph: metadata.sourceGlyph } : {}),
        },
      };

      await this.#system.writeText(JSON.stringify(payload));

      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<ClipboardReadResult> {
    try {
      const text = await this.#system.readText();
      const offers = this.#offersFromText(text);

      const native = tryDeserialize(text);
      if (native) return { kind: "content", content: native, source: "shift" };

      for (const importer of this.#importers) {
        const offer = importer.pick(offers);
        if (!offer) continue;

        const imported = await importer.import(offer);
        if (imported) return { kind: "content", content: imported, source: importer.id };
      }

      if (text.trim().length > 0) {
        return {
          kind: "unsupported",
          offeredTypes: offers.map((offer) => offer.mimeType),
        };
      }
    } catch {
      if (this.#internalState.content) {
        return { kind: "content", content: this.#internalState.content, source: "shift" };
      }
    }

    return { kind: "empty" };
  }

  nextPasteOffset(): { x: number; y: number } {
    const offset = DEFAULT_PASTE_OFFSET * (this.#pasteCount + 1);
    this.#pasteCount++;
    return { x: offset, y: -offset };
  }

  /** @knipclassignore — public clipboard API for edit-session resets. */
  resetPasteOffset(): void {
    this.#pasteCount = 0;
  }

  #offersFromText(text: string): readonly ClipboardOffer[] {
    return text.length > 0 ? [{ mimeType: "text/plain", text }] : [];
  }
}

function tryDeserialize(text: string): ShiftContent | null {
  try {
    const payload = JSON.parse(text);
    if (payload.format !== "shift/glyph-data" || payload.version > 1) return null;
    if (!ValidateClipboard.isShiftContent(payload.content)) return null;
    return payload.content;
  } catch {
    return null;
  }
}
