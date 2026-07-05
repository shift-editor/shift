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
 * Every editing verb pushes one operation by default. Use
 * {@link transaction} to group multiple intents into one `workspace.apply`,
 * one SQLite transaction, and one undo step. Echoes fold by substitution only
 * (replace structure, replace values); the queue contains zero
 * change-application or save semantics. Undo, redo, snapshot reads, and save
 * are serialized through the same queue so none can overtake a committed edit.
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

  #chain: Promise<unknown> = Promise.resolve();
  #busy = 0;
  #transaction: { readonly label: string; readonly intents: FontIntent[] } | null = null;

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

  /** Commits one intent as its own operation unless a transaction is open. */
  push(intent: FontIntent): void {
    const transaction = this.#transaction;
    if (transaction) {
      transaction.intents.push(intent);
      return;
    }

    this.#enqueueApply([intent]);
  }

  /**
   * Groups synchronous edit intents into one workspace operation.
   *
   * @remarks
   * Calls to {@link push} inside `body` are buffered and committed as one apply
   * after the outermost transaction returns. Transactions are synchronous;
   * callers must complete all edits before returning.
   *
   * @param label - Human-readable operation name for diagnostics and future ledger labels.
   * @param body - Synchronous edit body that may call layer mutation APIs.
   * @returns The value returned by `body`.
   * @throws {Error} when `body` returns a Promise.
   */
  transaction<TResult>(label: string, body: () => TResult): TResult {
    const active = this.#transaction;
    if (active) {
      return this.#runTransactionBody(label, body);
    }

    this.#transaction = { label, intents: [] };

    try {
      const result = this.#runTransactionBody(label, body);
      const transaction = this.#transaction;
      this.#transaction = null;
      this.#enqueueApply(transaction.intents);
      return result;
    } catch (error) {
      this.#transaction = null;
      throw error;
    }
  }

  #runTransactionBody<TResult>(label: string, body: () => TResult): TResult {
    const result = body();

    if (result instanceof Promise) {
      throw new Error(`workspace transaction "${label}" must be synchronous`);
    }

    return result;
  }

  /** Resolves when every queued and in-flight operation has settled. */
  async settled(): Promise<void> {
    this.#assertNoTransaction("settle workspace edits");

    while (this.#busy > 0) {
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
    this.#assertNoTransaction("run a serialized workspace operation");
    return this.#serialize(job);
  }

  #enqueueApply(intents: FontIntent[]): void {
    if (intents.length === 0) return;

    this.#settledCell.set(false);
    if (this.#commitState.peek() === "idle") {
      this.#commitState.set("queued");
    }

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
    if (this.#busy === 0) {
      this.#settledCell.set(true);
      this.#commitState.set("idle");
    }
  }

  #assertNoTransaction(action: string): void {
    const transaction = this.#transaction;
    if (!transaction) return;

    throw new Error(`cannot ${action} while workspace transaction "${transaction.label}" is open`);
  }

  /** Recovery: discard loaded projections and reload the workspace summary from utility. */
  async #resync(): Promise<void> {
    this.#store.replaceWorkspace(await this.#workspace.snapshot());
  }
}
