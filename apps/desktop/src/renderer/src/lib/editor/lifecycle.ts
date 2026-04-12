/**
 * Editor lifecycle event system.
 *
 * Provides a typed event emitter for imperative lifecycle events that cascade
 * across multiple subsystems. Subsystems subscribe independently — Editor
 * emits events without knowing who listens.
 *
 * For continuous state changes (glyph, selection, viewport), use signals.
 * Lifecycle events are for one-shot imperative actions: "a font was loaded",
 * "the editor is being destroyed", etc.
 */
import type { Font } from "../model/Font";

export interface LifecycleEventMap {
  /** A new font file was loaded. Subsystems should clear caches and reset state. */
  fontLoaded: { font: Font };
  /** The font was saved to disk. */
  fontSaved: { path: string };
  /** The editor is being torn down. Subsystems should dispose resources. */
  destroying: undefined;
}

export type LifecycleEvent = keyof LifecycleEventMap;

type Handler<T> = T extends undefined ? () => void : (payload: T) => void;

export class EventEmitter {
  #listeners = new Map<LifecycleEvent, Set<Handler<never>>>();

  on<E extends LifecycleEvent>(event: E, handler: Handler<LifecycleEventMap[E]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(handler as Handler<never>);

    return () => {
      set!.delete(handler as Handler<never>);
    };
  }

  emit<E extends LifecycleEvent>(
    event: E,
    ...args: LifecycleEventMap[E] extends undefined ? [] : [LifecycleEventMap[E]]
  ): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    const payload = args[0] as LifecycleEventMap[E];
    for (const handler of set) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handler as any)(payload);
    }
  }

  /** Remove all listeners. Called during teardown. */
  dispose(): void {
    this.#listeners.clear();
  }
}
