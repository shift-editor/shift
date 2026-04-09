/**
 * ShiftState — typed, persistent state primitive.
 *
 * Tools and subsystems register their own state via editor.registerState().
 * Each ShiftState is a reactive signal with persistence metadata. The
 * persistence kernel captures/hydrates all registered states generically —
 * no custom modules or Editor delegation methods needed.
 *
 * App-scoped states persist across documents (settings, preferences).
 * Document-scoped states persist per font file (text runs, viewport).
 */
import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";

export type StateScope = "app" | "document";

export interface ShiftStateOptions<T> {
  /** Unique persistence key. */
  id: string;
  /** Whether this state is per-app or per-document. */
  scope: StateScope;
  /** Factory for the initial/default value. */
  initial: () => T;
  /** Serialize value for localStorage. */
  serialize: (value: T) => unknown;
  /** Deserialize and validate from localStorage. Returns the value or throws. */
  deserialize: (json: unknown) => T;
}

export interface ShiftState<T> {
  readonly id: string;
  readonly scope: StateScope;
  /** Read the current value. Tracks dependency if inside computed/effect. */
  readonly value: T;
  /** Read without tracking. */
  peek(): T;
  /** Update the value. Triggers reactive subscribers and persistence. */
  set(value: T): void;
  /** Reset to initial value. */
  reset(): void;
}

export class ShiftStateImpl<T> implements ShiftState<T> {
  readonly id: string;
  readonly scope: StateScope;
  readonly #signal: WritableSignal<T>;
  readonly #initial: () => T;
  readonly #serialize: (value: T) => unknown;
  readonly #deserialize: (json: unknown) => T;

  constructor(options: ShiftStateOptions<T>) {
    this.id = options.id;
    this.scope = options.scope;
    this.#initial = options.initial;
    this.#serialize = options.serialize;
    this.#deserialize = options.deserialize;
    this.#signal = signal<T>(options.initial());
  }

  get value(): T {
    return this.#signal.value;
  }

  peek(): T {
    return this.#signal.peek();
  }

  set(value: T): void {
    this.#signal.set(value);
  }

  reset(): void {
    this.#signal.set(this.#initial());
  }

  /** @internal Used by persistence kernel. */
  capture(): unknown {
    return this.#serialize(this.#signal.peek());
  }

  /** @internal Used by persistence kernel. */
  hydrate(json: unknown): void {
    this.#signal.set(this.#deserialize(json));
  }

  /** @knipclassignore — used by persistence kernel via registry.all() */
  get signal(): Signal<T> {
    return this.#signal;
  }
}

export class StateRegistry {
  #states = new Map<string, ShiftStateImpl<unknown>>();

  register<T>(options: ShiftStateOptions<T>): ShiftState<T> {
    if (this.#states.has(options.id)) {
      throw new Error(`State "${options.id}" already registered`);
    }

    const state = new ShiftStateImpl(options);
    this.#states.set(options.id, state as ShiftStateImpl<unknown>);
    return state;
  }

  getByScope(scope: StateScope): ShiftStateImpl<unknown>[] {
    return Array.from(this.#states.values()).filter((s) => s.scope === scope);
  }

  all(): ShiftStateImpl<unknown>[] {
    return Array.from(this.#states.values());
  }

  get(id: string): ShiftStateImpl<unknown> | undefined {
    return this.#states.get(id);
  }

  clear(): void {
    this.#states.clear();
  }
}
