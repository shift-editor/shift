import type { Editor } from "@/lib/editor/Editor";

export type DocumentIdentity =
  | { readonly kind: "untitled"; readonly id: string }
  | { readonly kind: "file"; readonly path: string };

export interface DocumentServices {
  readonly persistence: DocumentPersistence;
  readonly setFilePath: (filePath: string | null) => void;
  readonly clearDirty: () => void;
  readonly createUntitledId?: () => string;
  readonly notifySaveCompleted?: (path: string) => Promise<void> | void;
}

export interface DocumentPersistence {
  closeDocument(): void;
  openDocument(filePath: string): void;
  openUntitledDocument(docId: string): void;
  onDocumentPathChanged(filePath: string | null): void;
  flushNow(): void;
}

/**
 * App-level lifecycle for the current font document.
 *
 * `Document` owns the distinction between no document, a new untitled font,
 * and a file-backed font. It coordinates editor font lifecycle, file identity,
 * dirty state, and document-scoped persistence.
 */
export class Document {
  readonly editor: Editor;

  readonly #persistence: DocumentPersistence;
  readonly #setFilePath: (filePath: string | null) => void;
  readonly #clearDirty: () => void;
  readonly #createUntitledId: () => string;
  readonly #notifySaveCompleted: (path: string) => Promise<void> | void;

  #identity: DocumentIdentity | null = null;

  constructor(editor: Editor, services: DocumentServices) {
    this.editor = editor;
    this.#persistence = services.persistence;
    this.#setFilePath = services.setFilePath;
    this.#clearDirty = services.clearDirty;
    this.#createUntitledId = services.createUntitledId ?? createUntitledId;
    this.#notifySaveCompleted =
      services.notifySaveCompleted ?? (() => undefined);
  }

  get identity(): DocumentIdentity | null {
    return this.#identity;
  }

  get loaded(): boolean {
    return this.editor.font.loaded;
  }

  createFont(): void {
    this.#persistence.closeDocument();

    const id = this.#createUntitledId();
    this.editor.createFont();
    this.#identity = { kind: "untitled", id };

    this.#setFilePath(null);
    this.#clearDirty();

    this.#persistence.openUntitledDocument(id);
    this.#persistence.flushNow();
  }

  openFont(path: string): void {
    this.#persistence.closeDocument();

    this.editor.loadFont(path);
    this.#identity = { kind: "file", path };

    this.#setFilePath(path);
    this.#clearDirty();

    this.#persistence.openDocument(path);
    this.#persistence.flushNow();
  }

  async saveFont(path?: string): Promise<void> {
    const savePath =
      path ?? (this.#identity?.kind === "file" ? this.#identity.path : null);
    if (!savePath) {
      throw new Error("Cannot save an untitled document without a file path");
    }

    await this.editor.saveFont(savePath);
    this.#identity = { kind: "file", path: savePath };

    this.#setFilePath(savePath);
    this.#clearDirty();

    this.#persistence.onDocumentPathChanged(savePath);
    this.#persistence.flushNow();
    await this.#notifySaveCompleted(savePath);
  }

  close(): void {
    this.#persistence.closeDocument();
    this.editor.closeFont();
    this.#identity = null;
    this.#setFilePath(null);
    this.#clearDirty();
  }
}

function createUntitledId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `untitled-${Date.now().toString(36)}`
  );
}
