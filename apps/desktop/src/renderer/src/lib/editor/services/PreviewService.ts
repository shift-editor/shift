import type { GlyphSnapshot } from "@shift/types";

export interface PreviewServiceDeps {
  beginPreview: () => void;
  cancelPreview: () => void;
  commitPreview: (label: string) => void;
  isInPreview: () => boolean;
  getPreviewSnapshot: () => GlyphSnapshot | null;
}

export class PreviewService {
  #deps: PreviewServiceDeps;

  constructor(deps: PreviewServiceDeps) {
    this.#deps = deps;
  }

  beginPreview(): void {
    this.#deps.beginPreview();
  }

  cancelPreview(): void {
    this.#deps.cancelPreview();
  }

  commitPreview(label: string): void {
    this.#deps.commitPreview(label);
  }

  isInPreview(): boolean {
    return this.#deps.isInPreview();
  }

  getPreviewSnapshot(): GlyphSnapshot | null {
    return this.#deps.getPreviewSnapshot();
  }
}
