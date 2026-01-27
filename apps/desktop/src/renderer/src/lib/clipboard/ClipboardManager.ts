import type { GlyphSnapshot, PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { ClipboardContent, PasteResult } from "./types";
import { ContentResolver } from "./ContentResolver";
import { PayloadSerializer } from "./PayloadSerializer";
import { ImporterRegistry } from "./ImporterRegistry";
import { SvgImporter } from "./importers/SvgImporter";

export interface ClipboardManagerContext {
  getSnapshot: () => GlyphSnapshot | null;
  getSelectedPointIds: () => ReadonlySet<PointId>;
  getSelectedSegmentIds: () => ReadonlySet<SegmentId>;
  getGlyphName: () => string | undefined;
  pasteContours: (contoursJson: string, offsetX: number, offsetY: number) => PasteResult;
  selectPoints: (pointIds: Set<PointId>) => void;
}

export class ClipboardManager {
  #resolver: ContentResolver;
  #serializer: PayloadSerializer;
  #importers: ImporterRegistry;
  #internalClipboard: ClipboardContent | null = null;
  #ctx: ClipboardManagerContext;

  constructor(ctx: ClipboardManagerContext) {
    this.#ctx = ctx;
    this.#resolver = new ContentResolver();
    this.#serializer = new PayloadSerializer();
    this.#importers = new ImporterRegistry();

    this.#importers.register(new SvgImporter());
  }

  async copy(): Promise<boolean> {
    const snapshot = this.#ctx.getSnapshot();
    const selectedPointIds = this.#ctx.getSelectedPointIds();
    const selectedSegmentIds = this.#ctx.getSelectedSegmentIds();

    const content = this.#resolver.resolve(snapshot, selectedPointIds, selectedSegmentIds);

    if (!content || content.contours.length === 0) {
      return false;
    }

    this.#internalClipboard = content;
    const json = this.#serializer.serialize(content, this.#ctx.getGlyphName());

    try {
      window.electronAPI.clipboardWriteText(json);
      return true;
    } catch {
      return false;
    }
  }

  async cut(): Promise<boolean> {
    const copied = await this.copy();
    return copied;
  }

  async paste(): Promise<PasteResult | null> {
    const content = await this.#readContent();
    if (!content || content.contours.length === 0) {
      return null;
    }

    const contoursJson = JSON.stringify(content.contours);
    const result = this.#ctx.pasteContours(contoursJson, 0, 0);

    if (result.success && result.createdPointIds.length > 0) {
      this.#ctx.selectPoints(new Set(result.createdPointIds));
    }

    return result;
  }

  hasInternalClipboard(): boolean {
    return this.#internalClipboard !== null;
  }

  getInternalClipboard(): ClipboardContent | null {
    return this.#internalClipboard;
  }

  async #readContent(): Promise<ClipboardContent | null> {
    try {
      const text = window.electronAPI.clipboardReadText();
      console.log("[Clipboard] Read from system clipboard:", text.substring(0, 100) + "...");

      const native = this.#serializer.tryDeserialize(text);
      if (native) {
        console.log("[Clipboard] Parsed as native format");
        return native;
      }

      const imported = this.#importers.tryImport(text);
      if (imported) {
        console.log(
          "[Clipboard] Imported via external importer, contours:",
          imported.contours.length,
        );
        return imported;
      }

      console.log("[Clipboard] Could not parse clipboard content");
      return null;
    } catch (err) {
      console.warn("[Clipboard] Failed to read system clipboard:", err);
      if (this.#internalClipboard) {
        console.log("[Clipboard] Falling back to internal clipboard");
        return this.#internalClipboard;
      }
      return null;
    }
  }
}
