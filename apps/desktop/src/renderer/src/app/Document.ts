import type { Editor } from "@/lib/editor/Editor";

export type DocumentIdentity =
  | { readonly kind: "untitled"; readonly id: string }
  | { readonly kind: "file"; readonly path: string };

export interface DocumentServices {
  readonly setFilePath: (filePath: string | null) => void;
  readonly clearDirty: () => void;
  readonly createUntitledId?: () => string;
  readonly notifySaveCompleted?: (path: string) => Promise<void> | void;
}

/**
 * App-level lifecycle for the current font document.
 *
 * `Document` owns the distinction between no document, a new untitled font,
 * and a file-backed font. It coordinates editor font lifecycle, file identity,
 * and dirty state.
 */
export class Document {
  readonly editor: Editor;

  readonly #setFilePath: (filePath: string | null) => void;
  readonly #clearDirty: () => void;
  readonly #createUntitledId: () => string;
  readonly #notifySaveCompleted: (path: string) => Promise<void> | void;

  #identity: DocumentIdentity | null = null;

  constructor(editor: Editor, services: DocumentServices) {
    this.editor = editor;
    this.#setFilePath = services.setFilePath;
    this.#clearDirty = services.clearDirty;
    this.#createUntitledId = services.createUntitledId ?? createUntitledId;
    this.#notifySaveCompleted = services.notifySaveCompleted ?? (() => undefined);
  }

  get identity(): DocumentIdentity | null {
    return this.#identity;
  }

  get loaded(): boolean {
    return this.editor.font.loaded;
  }

  createFont(): void {
    const id = this.#createUntitledId();
    this.editor.createFont();
    this.#identity = { kind: "untitled", id };

    this.#setFilePath(null);
    this.#clearDirty();
  }

  openFont(path: string): void {
    this.editor.loadFont(path);
    this.#identity = { kind: "file", path };

    this.#setFilePath(path);
    this.#clearDirty();
  }

  async saveFont(path?: string): Promise<void> {
    const savePath = path ?? (this.#identity?.kind === "file" ? this.#identity.path : null);
    if (!savePath) {
      throw new Error("Cannot save an untitled document without a file path");
    }

    await this.editor.saveFont(savePath);
    this.#identity = { kind: "file", path: savePath };

    this.#setFilePath(savePath);
    this.#clearDirty();

    await this.#notifySaveCompleted(savePath);
  }

  async exportFont(path: string): Promise<void> {
    await this.editor.exportFont(path);
  }

  close(): void {
    this.editor.closeFont();
    this.#identity = null;
    this.#setFilePath(null);
    this.#clearDirty();
  }
}

function createUntitledId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `untitled-${Date.now().toString(36)}`;
}
