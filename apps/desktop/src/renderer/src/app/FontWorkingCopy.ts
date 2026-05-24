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

  readonly #identityCell = signal<DocumentIdentity | null>(null, { name: "workingCopy.identity" });
  readonly #filePathCell = signal<string | null>(null, { name: "workingCopy.filePath" });
  readonly #currentRevisionCell = signal(0, { name: "workingCopy.currentRevision" });
  readonly #savedRevisionCell = signal(0, { name: "workingCopy.savedRevision" });
  readonly #savingCell = signal(false, { name: "workingCopy.saving" });
  readonly #exportingCell = signal(false, { name: "workingCopy.exporting" });

  readonly #fileNameCell = computed(() => fileNameFromPath(this.#filePathCell.value), {
    name: "workingCopy.fileName",
  });
  readonly #dirtyCell = computed(
    () => this.#savedRevisionCell.value < this.#currentRevisionCell.value,
    {
      name: "workingCopy.dirty",
    },
  );

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
        if (services.setNativeFilePath) services.setNativeFilePath(this.#filePathCell.value);
      }),
      effect(() => {
        if (services.setNativeDirty) services.setNativeDirty(this.#dirtyCell.value);
      }),
    ];
  }

  /**
   * Returns the current document identity as a snapshot.
   *
   * @returns null when no font document is loaded.
   * @see {@link identityCell}
   */
  get identity(): DocumentIdentity | null {
    return this.#identityCell.peek();
  }

  /**
   * Reactive document identity for UI and host-shell projections.
   *
   * @remarks
   * Cells expose live reactive state. Read `.value` inside computed/effect
   * contexts or use `useSignalState`; use `.peek()` or {@link identity} for
   * non-reactive reads.
   */
  get identityCell(): Signal<DocumentIdentity | null> {
    return this.#identityCell;
  }

  /**
   * Returns the current file path as a snapshot.
   *
   * @returns null for untitled documents and when no document is loaded.
   * @see {@link filePathCell}
   */
  get filePath(): string | null {
    return this.#filePathCell.peek();
  }

  /**
   * Reactive path for the loaded file-backed document.
   *
   * @remarks
   * Untitled documents publish `null` until saved to a path.
   */
  get filePathCell(): Signal<string | null> {
    return this.#filePathCell;
  }

  /**
   * Returns the current display file name as a snapshot.
   *
   * @returns null when the working copy has no file path.
   * @see {@link fileNameCell}
   */
  get fileName(): string | null {
    return this.#fileNameCell.peek();
  }

  /**
   * Reactive display file name derived from {@link filePathCell}.
   */
  get fileNameCell(): Signal<string | null> {
    return this.#fileNameCell;
  }

  /**
   * Returns the live document revision as a snapshot.
   *
   * @see {@link currentRevisionCell}
   */
  get currentRevision(): number {
    return this.#currentRevisionCell.peek();
  }

  /**
   * Reactive revision of the in-memory document state.
   *
   * @remarks
   * This advances after committed bridge mutations. Dirty state is derived by
   * comparing it with {@link savedRevisionCell}.
   */
  get currentRevisionCell(): Signal<number> {
    return this.#currentRevisionCell;
  }

  /**
   * Returns the last persisted document revision as a snapshot.
   *
   * @see {@link savedRevisionCell}
   */
  get savedRevision(): number {
    return this.#savedRevisionCell.peek();
  }

  /**
   * Reactive revision that last completed a save.
   */
  get savedRevisionCell(): Signal<number> {
    return this.#savedRevisionCell;
  }

  /**
   * Returns whether the working copy has unsaved committed changes.
   *
   * @see {@link dirtyCell}
   */
  get dirty(): boolean {
    return this.#dirtyCell.peek();
  }

  /**
   * Reactive dirty state derived from current and saved revisions.
   *
   * @remarks
   * This is not mutable state. A save only clears dirty when the saved revision
   * catches up to the current revision, so edits that land during a save keep
   * the document dirty.
   */
  get dirtyCell(): Signal<boolean> {
    return this.#dirtyCell;
  }

  /**
   * Reactive flag for an in-flight save operation.
   */
  get savingCell(): Signal<boolean> {
    return this.#savingCell;
  }

  /**
   * Reactive flag for an in-flight export operation.
   */
  get exportingCell(): Signal<boolean> {
    return this.#exportingCell;
  }

  get loaded(): boolean {
    return this.editor.font.loaded;
  }

  recordCurrentRevision(): void {
    this.#currentRevisionCell.set(this.editor.font.revision);
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
      this.#identityCell.set({ kind: "untitled", id });
      this.#filePathCell.set(null);
      this.#currentRevisionCell.set(revision);
      this.#savedRevisionCell.set(revision);
    });

    this.#persistence.openUntitledDocument(id);
    this.#persistence.flushNow();
  }

  openFont(path: string): void {
    this.#persistence.closeDocument();

    this.editor.loadFont(path);
    const revision = this.editor.font.revision;

    batch(() => {
      this.#identityCell.set({ kind: "file", path });
      this.#filePathCell.set(path);
      this.#currentRevisionCell.set(revision);
      this.#savedRevisionCell.set(revision);
    });

    this.#persistence.openDocument(path);
    this.#persistence.flushNow();
  }

  async saveFont(path?: string): Promise<void> {
    const identity = this.#identityCell.peek();
    const savePath = path ?? (identity?.kind === "file" ? identity.path : null);
    if (!savePath) {
      throw new Error("Cannot save an untitled document without a file path");
    }

    this.#savingCell.set(true);
    try {
      const result = await this.editor.saveFont(savePath);
      batch(() => {
        this.#identityCell.set({ kind: "file", path: result.path });
        this.#filePathCell.set(result.path);
        this.#savedRevisionCell.set(result.revision);
      });

      this.#persistence.onDocumentPathChanged(result.path);
      this.#persistence.flushNow();
      await this.#notifySaveCompleted(result.path);
    } finally {
      this.#savingCell.set(false);
    }
  }

  async exportFont(path: string): Promise<void> {
    this.#exportingCell.set(true);
    try {
      await this.editor.exportFont(path);
    } finally {
      this.#exportingCell.set(false);
    }
  }

  close(): void {
    this.#persistence.closeDocument();
    this.editor.closeFont();
    batch(() => {
      this.#identityCell.set(null);
      this.#filePathCell.set(null);
      this.#currentRevisionCell.set(0);
      this.#savedRevisionCell.set(0);
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
