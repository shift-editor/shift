import type {
  AppliedChange,
  FontIntent,
  GlyphId,
  GlyphState,
  LayerId,
  SourceId,
} from "@shift/types";
import { signal, type Signal } from "@/lib/signals/signal";
import type { GlyphSourceState } from "@/lib/model/GlyphSourceState";
import type { WorkspaceClient } from "./WorkspaceClient";

/** Where one layer's replace-grade echoes fold; registered per open session. */
type FoldTarget = {
  state: GlyphSourceState;
  glyphId: GlyphId;
  sourceId: SourceId;
};

/**
 * The renderer's single durable-write path.
 *
 * @remarks
 * Every editing verb pushes one intent; all intents in the same microtask
 * coalesce into ONE `workspace.apply` — one SQLite transaction, one undo
 * step. Echoes fold by substitution only (replace structure, replace
 * values); the writer contains zero change-application semantics. Undo and
 * redo are serialized through the same queue so they can never overtake a
 * pending flush. Tools never hold the writer — they speak domain verbs on
 * `GlyphSource`.
 */
export class ChangeWriter {
  readonly #workspace: WorkspaceClient;
  readonly #targets = new Map<LayerId, FoldTarget>();
  readonly #$settled = signal(true);

  #queue: FontIntent[] = [];
  #label: string | undefined;
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
  get $settled(): Signal<boolean> {
    return this.#$settled;
  }

  /** Routes one layer's echoes to its session state. */
  register(layerId: LayerId, target: FoldTarget): void {
    this.#targets.set(layerId, target);
  }

  /** Queues one intent; everything in the same microtask becomes one apply. */
  push(intent: FontIntent, label?: string): void {
    this.#queue.push(intent);
    this.#label ??= label;
    this.#$settled.set(false);

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
    this.#enqueueFlush();
    return this.#serialize(async () => {
      const applied = await this.#workspace.undo();
      if (applied) this.#fold(applied);
      return applied;
    });
  }

  /** Pulls replace-grade glyph state, serialized behind pending writes. */
  glyph(glyphId: GlyphId, sourceId: SourceId): Promise<GlyphState | null> {
    this.#enqueueFlush();
    return this.#serialize(() => this.#workspace.glyph(glyphId, sourceId));
  }

  /** Replays the latest redo entry after pending pushes flush. */
  redo(): Promise<AppliedChange | null> {
    this.#enqueueFlush();
    return this.#serialize(async () => {
      const applied = await this.#workspace.redo();
      if (applied) this.#fold(applied);
      return applied;
    });
  }

  #enqueueFlush(): void {
    this.#flushQueued = false;
    if (this.#queue.length === 0) return;

    const intents = this.#queue;
    const label = this.#label;
    this.#queue = [];
    this.#label = undefined;

    void this.#serialize(async () => {
      try {
        this.#fold(await this.#workspace.apply(intents, label));
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
      this.#$settled.set(true);
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
      const state = await this.#workspace.glyph(target.glyphId, target.sourceId);
      if (state && state.layerId === layerId) {
        target.state.replace(state);
      }
    }
  }
}
