import type { AppliedChange, FontIntent, GlyphState, LayerId } from "@shift/types";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import { signal, type Signal } from "@/lib/signals/signal";
import type { GlyphLayerState } from "@/lib/model/GlyphLayerState";
import type { WorkspaceClient } from "./WorkspaceClient";

export type WorkspaceCommitState = "idle" | "queued" | "applying";

/** Where one layer's replace-grade echoes fold; registered per open session. */
type FoldTarget = {
  state: GlyphLayerState;
};

/**
 * Tracks optimistic renderer edits until the utility workspace echoes them.
 *
 * @remarks
 * Every editing verb pushes one intent; all intents in the same microtask
 * coalesce into ONE `workspace.apply` — one SQLite transaction, one undo
 * step. Echoes fold by substitution only (replace structure, replace
 * values); the queue contains zero change-application or save semantics.
 * Undo, redo, and save are serialized through the same queue so none can
 * overtake a pending flush. Tools never hold the queue — they speak domain
 * verbs on `GlyphLayer`.
 *
 * Save ownership lives in the utility. The renderer issues save as one more op
 * on this queue (see {@link save}); because it shares the FIFO edit lane, the
 * utility serializes the write behind every committed edit with no cross-lane
 * watermark.
 */
export class WorkspaceEditCoordinator {
  readonly #workspace: WorkspaceClient;
  readonly #targets = new Map<LayerId, FoldTarget>();
  readonly #settledCell = signal(true);
  readonly #commitState = signal<WorkspaceCommitState>("idle", {
    name: "workspace.commitState",
  });

  #queue: FontIntent[] = [];
  #flushQueued = false;
  #chain: Promise<unknown> = Promise.resolve();
  #busy = 0;

  constructor(workspace: WorkspaceClient) {
    this.#workspace = workspace;
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

  /** Routes one layer's echoes to its session state. */
  register(layerId: LayerId, target: FoldTarget): void {
    this.#targets.set(layerId, target);
  }

  /** Queues one intent; everything in the same microtask becomes one apply. */
  push(intent: FontIntent): void {
    this.#queue.push(intent);
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
    while (this.#queue.length > 0 || this.#busy > 0) {
      this.#enqueueFlush();
      await this.#chain;
    }
  }

  /** Replays the latest undo entry after pending pushes flush. */
  undo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#workspace.undo();
      if (applied) this.#fold(applied);
      return applied;
    });
  }

  /** Pulls replace-grade glyph state by layer id, serialized behind pending writes. */
  layer(layerId: LayerId): Promise<GlyphState | null> {
    return this.#withFlush(() => this.#workspace.layer(layerId));
  }

  /** Replays the latest redo entry after pending pushes flush. */
  redo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#workspace.redo();
      if (applied) this.#fold(applied);
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
    if (this.#queue.length === 0) return;

    const intents = this.#queue;
    this.#queue = [];

    void this.#serialize(async () => {
      try {
        this.#commitState.set("applying");
        const applied = await this.#workspace.apply(intents);
        this.#fold(applied);
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
    if (this.#busy === 0 && this.#queue.length === 0) {
      this.#settledCell.set(true);
      this.#commitState.set("idle");
    }
  }

  /** Substitution-only fold: replace structure, replace values, never merge. */
  #fold(applied: AppliedChange): void {
    for (const layer of applied.layers) {
      const target = this.#targets.get(layer.layerId);
      if (!target) continue; // not materialized; records grain already folded

      if (layer.structure) {
        target.state.replace({
          layerId: layer.layerId,
          structure: layer.structure,
          values: layer.values,
        });
      } else {
        target.state.replaceValues(layer.values);
      }
    }
  }

  /** Blunt recovery: re-pull truth for every registered layer and stomp. */
  async #resync(): Promise<void> {
    for (const [layerId, target] of this.#targets) {
      const state = await this.#workspace.layer(layerId);
      if (state) {
        target.state.replace(state);
      }
    }
  }
}
