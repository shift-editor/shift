import type { GlyphSnapshot } from "@shift/types";
import type { ClipboardContent, PasteResult } from "./types";
import { ContentResolver } from "./ContentResolver";
import { PayloadSerializer } from "./PayloadSerializer";
import { ImporterRegistry } from "./ImporterRegistry";
import { SvgImporter } from "./importers/SvgImporter";
import type { Editor } from "@/lib/editor/Editor";

export class ClipboardManager {
  #resolver: ContentResolver;
  #serializer: PayloadSerializer;
  #importers: ImporterRegistry;
  #internalClipboard: ClipboardContent | null = null;
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#resolver = new ContentResolver();
    this.#serializer = new PayloadSerializer();
    this.#importers = new ImporterRegistry();

    this.#importers.register(new SvgImporter());
  }

  async copy(): Promise<boolean> {
    const glyph = this.#editor.getGlyph();
    const selectedPointIds = [...this.#editor.selectedPointIds.peek()];
    const selectedSegmentIds = [...this.#editor.selectedSegmentIds.peek()];

    const content = this.#resolver.resolve(
      glyph as GlyphSnapshot | null,
      selectedPointIds,
      selectedSegmentIds,
    );

    if (!content || content.contours.length === 0) {
      return false;
    }

    this.#internalClipboard = content;
    const json = this.#serializer.serialize(content, glyph?.name);

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
    const result = this.#editor.fontEngine.editing.pasteContours(contoursJson, 0, 0);

    if (result.success && result.createdPointIds.length > 0) {
      this.#editor.selectPoints(result.createdPointIds);
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
