import type { AppliedChange, FontIntent } from "@shift/types";
import type {
  WorkspaceDocumentState,
  WorkspaceGlyphSnapshot,
  WorkspaceGlyphSnapshotRequest,
} from "@shared/workspace/protocol";
import { signal, type Signal, type WritableSignal } from "@/lib/signals/signal";
import type { FontStore, WorkspaceCommitState } from "@/lib/model/FontStore";
import type { WorkspaceClient } from "./WorkspaceClient";

export type { WorkspaceCommitState } from "@/lib/model/FontStore";

/**
 * Tracks optimistic renderer edits until the utility workspace echoes them.
 *
 * @remarks
 * Every editing verb pushes one intent; all intents in the same microtask
 * coalesce into ONE `workspace.apply` — one SQLite transaction, one undo
 * step. Echoes fold by substitution only (replace structure, replace
 * values); the queue contains zero change-application or save semantics.
 * Undo, redo, snapshot reads, and save are serialized through the same queue so
 * none can overtake a pending flush.
 *
 * Save ownership lives in the utility. The renderer issues save as one more op
 * on this queue (see {@link save}); because it shares the FIFO edit lane, the
 * utility serializes the write behind every committed edit with no cross-lane
 * watermark.
 */
export class WorkspaceEditCoordinator {
  readonly #workspace: WorkspaceClient;
  readonly #store: FontStore;
  readonly #settledCell: WritableSignal<boolean>;
  readonly #commitState: WritableSignal<WorkspaceCommitState>;

  #flushQueued = false;
  #chain: Promise<unknown> = Promise.resolve();
  #busy = 0;
  #pendingIntents: FontIntent[] = [];

  constructor(workspace: WorkspaceClient, store: FontStore) {
    this.#workspace = workspace;
    this.#store = store;
    this.#settledCell = signal(true);
    this.#commitState = signal<WorkspaceCommitState>("idle", {
      name: "workspace.commitState",
    });
  }

  /**
   * False while any intent is queued or in flight. Drives the dirty
   * indicator: un-echoed state must never read as durable.
   */
  get settledCell(): Signal<boolean> {
    return this.#settledCell;
  }

  /**
   * Returns the renderer commit lifecycle for locally-authored edits.
   *
   * @remarks
   * This is intentionally separate from utility-owned `documentState.dirty`.
   * It covers the short window after a tool commits an edit locally but before
   * the utility process has echoed the new dirty state.
   */
  get commitStateCell(): Signal<WorkspaceCommitState> {
    return this.#commitState;
  }

  /** Queues one intent; everything in the same microtask becomes one apply. */
  push(intent: FontIntent): void {
    this.#pendingIntents.push(intent);
    this.#settledCell.set(false);
    if (this.#commitState.peek() === "idle") {
      this.#commitState.set("queued");
    }

    if (!this.#flushQueued) {
      this.#flushQueued = true;
      queueMicrotask(() => this.#enqueueFlush());
    }
  }

  /** Resolves when every queued and in-flight operation has settled. */
  async settled(): Promise<void> {
    while (this.#pendingIntents.length > 0 || this.#busy > 0) {
      this.#enqueueFlush();
      await this.#chain;
    }
  }

  apply(intents: FontIntent[]): Promise<AppliedChange> {
    return this.#withFlush(async () => {
      const applied = await this.#workspace.apply(intents);
      this.#store.applyWorkspaceChange(applied);
      return applied;
    });
  }

  /** Replays the latest undo entry after pending pushes flush. */
  undo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#workspace.undo();
      if (applied) this.#store.applyWorkspaceChange(applied);
      return applied;
    });
  }

  /** Pulls replace-grade glyph snapshots by glyph id, serialized behind pending writes. */
  async readGlyphSnapshots(
    requests: readonly WorkspaceGlyphSnapshotRequest[],
  ): Promise<WorkspaceGlyphSnapshot[]> {
    if (requests.length === 0) return [];
    return this.#withFlush(() => this.#workspace.glyphSnapshots(requests));
  }

  /** Replays the latest redo entry after pending pushes flush. */
  redo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#workspace.redo();
      if (applied) this.#store.applyWorkspaceChange(applied);
      return applied;
    });
  }

  /** Reads document state behind every queued and in-flight edit. */
  state(): Promise<WorkspaceDocumentState | null> {
    return this.#withFlush(() => this.#workspace.documentState());
  }

  /**
   * Issues a save behind every queued and in-flight committed op.
   *
   * @param path - target path for Save As, or null to save the current target.
   */
  save(path: string | null): Promise<WorkspaceDocumentState> {
    return this.#withFlush(() =>
      path === null ? this.#workspace.save() : this.#workspace.saveAs(path),
    );
  }

  #withFlush<T>(job: () => Promise<T>): Promise<T> {
    this.#enqueueFlush();
    return this.#serialize(job);
  }

  #enqueueFlush(): void {
    this.#flushQueued = false;
    if (this.#pendingIntents.length === 0) return;

    const intents = this.#pendingIntents;
    this.#pendingIntents = [];

    void this.#serialize(async () => {
      try {
        this.#commitState.set("applying");
        const applied = await this.#workspace.apply(intents);
        this.#store.applyWorkspaceChange(applied);
      } catch (error) {
        console.error("workspace apply failed; resyncing from truth", error);
        await this.#resync();
      }
    });
  }

  #serialize<T>(job: () => Promise<T>): Promise<T> {
    this.#busy += 1;

    const run = this.#chain.then(job);
    this.#chain = run.then(
      () => this.#afterJob(),
      () => this.#afterJob(),
    );

    return run;
  }

  #afterJob(): void {
    this.#busy -= 1;
    if (this.#busy === 0 && this.#pendingIntents.length === 0) {
      this.#settledCell.set(true);
      this.#commitState.set("idle");
    }
  }

  /** Recovery: discard loaded projections and reload the workspace summary from utility. */
  async #resync(): Promise<void> {
    this.#store.replaceWorkspace(await this.#workspace.snapshot());
  }
}
