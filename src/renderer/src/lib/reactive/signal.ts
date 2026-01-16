/**
 * Minimal signals implementation for reactive rendering.
 *
 * Provides fine-grained reactivity:
 * - signal<T>() - writable reactive value
 * - computed<T>() - derived value that auto-tracks dependencies
 * - effect() - side effect that re-runs when dependencies change
 * - batch() - group multiple updates into one notification
 */

// Current computation being tracked (for auto-dependency collection)
let currentComputation: Computation | null = null;

// Batch state
let batchDepth = 0;
const pendingEffects = new Set<EffectImpl>();

// Flag to prevent notification during notification
let isNotifying = false;
const pendingNotifications = new Set<SignalImpl<unknown>>();

interface Computation {
  execute(): void;
  dependencies: Set<SignalNode>;
}

interface SignalNode {
  _unsubscribe(computation: Computation): void;
}

// ═══════════════════════════════════════════════════════════
// SIGNAL
// ═══════════════════════════════════════════════════════════

export interface Signal<T> {
  /** Get the current value. Tracks dependency if inside computed/effect. */
  readonly value: T;
  /** Get value without tracking (peek at it). */
  peek(): T;
}

export interface WritableSignal<T> extends Signal<T> {
  /** Set or get the value. Setting notifies subscribers. */
  value: T;
  /** Explicitly set the value. */
  set(value: T): void;
  /** Update value using a function. */
  update(fn: (prev: T) => T): void;
}

class SignalImpl<T> implements WritableSignal<T>, SignalNode {
  #value: T;
  #subscribers = new Set<Computation>();

  constructor(initialValue: T) {
    this.#value = initialValue;
  }

  get value(): T {
    // Track this signal as a dependency of the current computation
    if (currentComputation) {
      this.#subscribers.add(currentComputation);
      currentComputation.dependencies.add(this);
    }
    return this.#value;
  }

  set value(newValue: T) {
    this.set(newValue);
  }

  peek(): T {
    return this.#value;
  }

  set(newValue: T): void {
    if (Object.is(this.#value, newValue)) return;

    this.#value = newValue;

    // If we're already notifying, queue this signal for later
    if (isNotifying) {
      pendingNotifications.add(this as SignalImpl<unknown>);
      return;
    }

    this._notify();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.#value));
  }

  _notify(): void {
    isNotifying = true;

    try {
      // Copy subscribers to avoid issues if they modify during iteration
      const subscribers = Array.from(this.#subscribers);

      for (const subscriber of subscribers) {
        if (batchDepth > 0 && subscriber instanceof EffectImpl) {
          // In batch mode, queue effects for later
          pendingEffects.add(subscriber);
        } else {
          subscriber.execute();
        }
      }
    } finally {
      isNotifying = false;

      // Process any pending notifications
      if (pendingNotifications.size > 0) {
        const pending = Array.from(pendingNotifications);
        pendingNotifications.clear();
        for (const sig of pending) {
          sig._notify();
        }
      }
    }
  }

  _unsubscribe(computation: Computation): void {
    this.#subscribers.delete(computation);
  }
}

/**
 * Create a writable signal with an initial value.
 */
export function signal<T>(initialValue: T): WritableSignal<T> {
  return new SignalImpl(initialValue);
}

// ═══════════════════════════════════════════════════════════
// COMPUTED
// ═══════════════════════════════════════════════════════════

export interface ComputedSignal<T> extends Signal<T> {
  /** Force recomputation even if dependencies haven't changed. */
  invalidate(): void;
}

class ComputedImpl<T> implements ComputedSignal<T>, Computation, SignalNode {
  #fn: () => T;
  #value: T | undefined;
  #dirty = true;
  #computing = false;
  #subscribers = new Set<Computation>();
  dependencies = new Set<SignalNode>();

  constructor(fn: () => T) {
    this.#fn = fn;
  }

  get value(): T {
    // Track this computed as a dependency
    if (currentComputation) {
      this.#subscribers.add(currentComputation);
      currentComputation.dependencies.add(this);
    }

    if (this.#dirty && !this.#computing) {
      this.#recompute();
    }

    return this.#value!;
  }

  peek(): T {
    if (this.#dirty && !this.#computing) {
      this.#recompute();
    }
    return this.#value!;
  }

  invalidate(): void {
    this.#dirty = true;
  }

  execute(): void {
    // Called when a dependency changes - mark dirty and notify subscribers
    if (!this.#dirty) {
      this.#dirty = true;
      // Copy subscribers to avoid issues during iteration
      const subscribers = Array.from(this.#subscribers);
      for (const subscriber of subscribers) {
        subscriber.execute();
      }
    }
  }

  #recompute(): void {
    // Prevent re-entrant computation
    if (this.#computing) return;
    this.#computing = true;

    try {
      // Clean up old dependencies
      for (const dep of this.dependencies) {
        dep._unsubscribe(this);
      }
      this.dependencies.clear();

      // Track new dependencies (intentional this-alias for reactive tracking)
      const prevComputation = currentComputation;
      // oxlint-disable-next-line typescript-eslint/no-this-alias
      currentComputation = this;

      try {
        this.#value = this.#fn();
        this.#dirty = false;
      } finally {
        currentComputation = prevComputation;
      }
    } finally {
      this.#computing = false;
    }
  }

  _unsubscribe(computation: Computation): void {
    this.#subscribers.delete(computation);
  }
}

/**
 * Create a computed signal that derives from other signals.
 * Dependencies are automatically tracked.
 */
export function computed<T>(fn: () => T): ComputedSignal<T> {
  return new ComputedImpl(fn);
}

// ═══════════════════════════════════════════════════════════
// EFFECT
// ═══════════════════════════════════════════════════════════

export interface Effect {
  /** Stop the effect and clean up subscriptions. */
  dispose(): void;
}

class EffectImpl implements Effect, Computation {
  #fn: () => void | (() => void);
  #cleanup: (() => void) | void;
  #disposed = false;
  #running = false;
  dependencies = new Set<SignalNode>();

  constructor(fn: () => void | (() => void)) {
    this.#fn = fn;
    this.execute();
  }

  execute(): void {
    // Prevent re-entrant execution and execution after disposal
    if (this.#disposed || this.#running) return;
    this.#running = true;

    try {
      // Run cleanup from previous execution
      if (this.#cleanup) {
        this.#cleanup();
        this.#cleanup = undefined;
      }

      // Clean up old dependencies
      for (const dep of this.dependencies) {
        dep._unsubscribe(this);
      }
      this.dependencies.clear();

      // Track new dependencies (intentional this-alias for reactive tracking)
      const prevComputation = currentComputation;
      // oxlint-disable-next-line typescript-eslint/no-this-alias
      currentComputation = this;

      try {
        this.#cleanup = this.#fn();
      } finally {
        currentComputation = prevComputation;
      }
    } finally {
      this.#running = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    // Run final cleanup
    if (this.#cleanup) {
      this.#cleanup();
      this.#cleanup = undefined;
    }

    // Unsubscribe from all dependencies
    for (const dep of this.dependencies) {
      dep._unsubscribe(this);
    }
    this.dependencies.clear();
  }
}

/**
 * Create an effect that runs when dependencies change.
 *
 * The function can optionally return a cleanup function that runs
 * before each re-execution and on dispose.
 *
 * @example
 * const count = signal(0);
 * const fx = effect(() => {
 *   console.log('Count:', count.value);
 *   return () => console.log('Cleanup');
 * });
 *
 * count.value = 1; // logs: "Cleanup", "Count: 1"
 * fx.dispose();    // logs: "Cleanup"
 */
export function effect(fn: () => void | (() => void)): Effect {
  return new EffectImpl(fn);
}

// ═══════════════════════════════════════════════════════════
// BATCH
// ═══════════════════════════════════════════════════════════

/**
 * Batch multiple signal updates into a single notification.
 * Effects are deferred until the batch completes.
 *
 * @example
 * const a = signal(1);
 * const b = signal(2);
 *
 * effect(() => console.log(a.value + b.value)); // logs: 3
 *
 * batch(() => {
 *   a.value = 10;
 *   b.value = 20;
 * }); // logs: 30 (only once, not twice)
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingEffects.size > 0) {
      // Flush all pending effects
      const effects = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const fx of effects) {
        fx.execute();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

/**
 * Run a function without tracking any signal reads as dependencies.
 */
export function untracked<T>(fn: () => T): T {
  const prevComputation = currentComputation;
  currentComputation = null;
  try {
    return fn();
  } finally {
    currentComputation = prevComputation;
  }
}

/**
 * Check if currently inside a reactive context (computed or effect).
 */
export function isTracking(): boolean {
  return currentComputation !== null;
}
