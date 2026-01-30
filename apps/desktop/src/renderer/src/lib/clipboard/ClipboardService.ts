import type { ClipboardContent, ClipboardState, ClipboardServiceDeps } from "./types";
import { ContentResolver } from "./ContentResolver";
import { PayloadSerializer } from "./PayloadSerializer";
import { ImporterRegistry } from "./ImporterRegistry";
import { SvgImporter } from "./importers/SvgImporter";

const DEFAULT_PASTE_OFFSET = 20;

export class ClipboardService {
  #resolver: ContentResolver;
  #serializer: PayloadSerializer;
  #importers: ImporterRegistry;
  #deps: ClipboardServiceDeps;
  #internalState: ClipboardState = { content: null, bounds: null, timestamp: 0 };
  #pasteCount = 0;

  constructor(deps: ClipboardServiceDeps) {
    this.#deps = deps;
    this.#resolver = new ContentResolver();
    this.#serializer = new PayloadSerializer();
    this.#importers = new ImporterRegistry();
    this.#importers.register(new SvgImporter());
  }

  resolveSelection(): ClipboardContent | null {
    const glyph = this.#deps.getGlyph();
    return this.#resolver.resolve(
      glyph,
      this.#deps.getSelectedPointIds(),
      this.#deps.getSelectedSegmentIds(),
    );
  }

  async write(content: ClipboardContent, sourceGlyph?: string): Promise<boolean> {
    this.#internalState = {
      content,
      bounds: this.#serializer.calculateBounds(content),
      timestamp: Date.now(),
    };
    this.#pasteCount = 0;

    try {
      const json = this.#serializer.serialize(content, sourceGlyph);
      window.electronAPI.clipboardWriteText(json);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<ClipboardState> {
    try {
      const text = window.electronAPI.clipboardReadText();
      const native = this.#serializer.tryDeserialize(text);
      if (native) {
        return {
          content: native,
          bounds: this.#serializer.calculateBounds(native),
          timestamp: Date.now(),
        };
      }
      const imported = this.#importers.tryImport(text);
      if (imported) {
        return {
          content: imported,
          bounds: this.#serializer.calculateBounds(imported),
          timestamp: Date.now(),
        };
      }
    } catch {
      // Fall through to internal state
    }
    return this.#internalState;
  }

  getNextPasteOffset(): { x: number; y: number } {
    const offset = DEFAULT_PASTE_OFFSET * (this.#pasteCount + 1);
    this.#pasteCount++;
    return { x: offset, y: -offset };
  }

  resetPasteCount(): void {
    this.#pasteCount = 0;
  }
}
