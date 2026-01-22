import type { ClipboardContent, ClipboardImporter } from "./types";

export class ImporterRegistry {
  #importers: ClipboardImporter[] = [];

  register(importer: ClipboardImporter): void {
    this.#importers.push(importer);
  }

  tryImport(text: string): ClipboardContent | null {
    for (const importer of this.#importers) {
      if (importer.canImport(text)) {
        const content = importer.import(text);
        if (content) return content;
      }
    }
    return null;
  }
}
