import type { Editor } from "@/lib/editor/Editor";
import { batch, computed, effect, signal, type Effect, type Signal } from "@/lib/signals/signal";

export type DocumentIdentity =
  | { readonly kind: "untitled"; readonly id: string }
  | { readonly kind: "file"; readonly path: string };

export interface FontWorkingCopyServices {
  readonly persistence: DocumentPersistence;
  readonly createUntitledId?: () => string;
  readonly notifySaveCompleted?: (path: string) => Promise<void> | void;
  readonly setNativeFilePath?: (filePath: string | null) => void;
  readonly setNativeDirty?: (dirty: boolean) => void;
}

export interface DocumentPersistence {
  closeDocument(): void;
  openDocument(filePath: string): void;
  openUntitledDocument(docId: string): void;
  onDocumentPathChanged(filePath: string | null): void;
  flushNow(): void;
}

/**
 * App-level working-copy model for the current font document.
 *
 * `FontWorkingCopy` owns file identity, document revisions, save/export
 * lifecycle, and the projection of saveability to Electron. Dirty state is
 * derived from revisions and is never set directly.
 */
export class FontWorkingCopy {
  readonly editor: Editor;

  readonly #persistence: DocumentPersistence;
  readonly #createUntitledId: () => string;
  readonly #notifySaveCompleted: (path: string) => Promise<void> | void;
  readonly #effects: Effect[];

  readonly #$identity = signal<DocumentIdentity | null>(null, { name: "workingCopy.identity" });
  readonly #$filePath = signal<string | null>(null, { name: "workingCopy.filePath" });
  readonly #$currentRevision = signal(0, { name: "workingCopy.currentRevision" });
  readonly #$savedRevision = signal(0, { name: "workingCopy.savedRevision" });
  readonly #$saving = signal(false, { name: "workingCopy.saving" });
  readonly #$exporting = signal(false, { name: "workingCopy.exporting" });

  readonly #$fileName = computed(() => fileNameFromPath(this.#$filePath.value), {
    name: "workingCopy.fileName",
  });
  readonly #$dirty = computed(() => this.#$savedRevision.value < this.#$currentRevision.value, {
    name: "workingCopy.dirty",
  });

  constructor(editor: Editor, services: FontWorkingCopyServices) {
    this.editor = editor;
    this.#persistence = services.persistence;
    this.#createUntitledId = services.createUntitledId ?? createUntitledId;
    this.#notifySaveCompleted = services.notifySaveCompleted ?? (() => undefined);

    this.editor.commandHistory.setOnDirty(() => {
      this.recordCurrentRevision();
    });

    this.#effects = [
      effect(() => {
        if (services.setNativeFilePath) services.setNativeFilePath(this.#$filePath.value);
      }),
      effect(() => {
        if (services.setNativeDirty) services.setNativeDirty(this.#$dirty.value);
      }),
    ];
  }

  get identity(): DocumentIdentity | null {
    return this.#$identity.peek();
  }

  get $identity(): Signal<DocumentIdentity | null> {
    return this.#$identity;
  }

  get filePath(): string | null {
    return this.#$filePath.peek();
  }

  get $filePath(): Signal<string | null> {
    return this.#$filePath;
  }

  get fileName(): string | null {
    return this.#$fileName.peek();
  }

  get $fileName(): Signal<string | null> {
    return this.#$fileName;
  }

  get currentRevision(): number {
    return this.#$currentRevision.peek();
  }

  get $currentRevision(): Signal<number> {
    return this.#$currentRevision;
  }

  get savedRevision(): number {
    return this.#$savedRevision.peek();
  }

  get $savedRevision(): Signal<number> {
    return this.#$savedRevision;
  }

  get dirty(): boolean {
    return this.#$dirty.peek();
  }

  get $dirty(): Signal<boolean> {
    return this.#$dirty;
  }

  get $saving(): Signal<boolean> {
    return this.#$saving;
  }

  get $exporting(): Signal<boolean> {
    return this.#$exporting;
  }

  get loaded(): boolean {
    return this.editor.font.loaded;
  }

  recordCurrentRevision(): void {
    this.#$currentRevision.set(this.editor.font.revision);
  }

  commitMutation<TResult>(mutate: () => TResult): TResult {
    const result = mutate();
    this.recordCurrentRevision();
    return result;
  }

  createFont(): void {
    this.#persistence.closeDocument();

    const id = this.#createUntitledId();
    this.editor.createFont();
    const revision = this.editor.font.revision;

    batch(() => {
      this.#$identity.set({ kind: "untitled", id });
      this.#$filePath.set(null);
      this.#$currentRevision.set(revision);
      this.#$savedRevision.set(revision);
    });

    this.#persistence.openUntitledDocument(id);
    this.#persistence.flushNow();
  }

  openFont(path: string): void {
    this.#persistence.closeDocument();

    this.editor.loadFont(path);
    const revision = this.editor.font.revision;

    batch(() => {
      this.#$identity.set({ kind: "file", path });
      this.#$filePath.set(path);
      this.#$currentRevision.set(revision);
      this.#$savedRevision.set(revision);
    });

    this.#persistence.openDocument(path);
    this.#persistence.flushNow();
  }

  async saveFont(path?: string): Promise<void> {
    const identity = this.#$identity.peek();
    const savePath = path ?? (identity?.kind === "file" ? identity.path : null);
    if (!savePath) {
      throw new Error("Cannot save an untitled document without a file path");
    }

    this.#$saving.set(true);
    try {
      const result = await this.editor.saveFont(savePath);
      batch(() => {
        this.#$identity.set({ kind: "file", path: result.path });
        this.#$filePath.set(result.path);
        this.#$savedRevision.set(result.revision);
      });

      this.#persistence.onDocumentPathChanged(result.path);
      this.#persistence.flushNow();
      await this.#notifySaveCompleted(result.path);
    } finally {
      this.#$saving.set(false);
    }
  }

  async exportFont(path: string): Promise<void> {
    this.#$exporting.set(true);
    try {
      await this.editor.exportFont(path);
    } finally {
      this.#$exporting.set(false);
    }
  }

  close(): void {
    this.#persistence.closeDocument();
    this.editor.closeFont();
    batch(() => {
      this.#$identity.set(null);
      this.#$filePath.set(null);
      this.#$currentRevision.set(0);
      this.#$savedRevision.set(0);
    });
  }

  dispose(): void {
    for (const effect of this.#effects) {
      effect.dispose();
    }
  }
}

function createUntitledId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `untitled-${Date.now().toString(36)}`;
}

function fileNameFromPath(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || null;
}
