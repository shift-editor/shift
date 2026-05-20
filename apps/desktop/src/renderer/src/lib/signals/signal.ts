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

let nextDebugId = 1;
let currentEpoch = 0;
const debugNodes = new Map<number, DebugNode>();
let traceSignalWrites = false;

// Batch state
let batchDepth = 0;
const pendingEffects = new Set<EffectImpl>();

// Flag to prevent notification during notification
let isNotifying = false;
const pendingNotifications = new Set<SignalImpl<unknown>>();

interface Computation {
  execute(): void;
  dependencies: Set<SignalNode>;
  readonly debugId: number;
  readonly name: string;
  readonly kind: SignalDebugKind;
  readonly lastChangedEpoch: number;
  debugWhySnapshot: Map<SignalNode, number> | null;
  debugTraceReport: ((message: string) => void) | null;
  debugSubscribers(): readonly Computation[];
  debugDependencies(): readonly SignalNode[];
  debugLastWrite(): SignalWriteDebugInfo | null;
}

interface SignalNode {
  _unsubscribe(computation: Computation): void;
  readonly debugId: number;
  readonly name: string;
  readonly kind: SignalDebugKind;
  readonly lastChangedEpoch: number;
  debugSubscribers(): readonly Computation[];
  debugDependencies(): readonly SignalNode[];
  debugLastWrite(): SignalWriteDebugInfo | null;
}

type SignalDebugKind = "signal" | "computed" | "effect";

type DebugNode = SignalNode | Computation;

export interface SignalWriteDebugInfo {
  readonly epoch: number;
  readonly operation: "set" | "update" | "invalidate";
  readonly stack: string | null;
}

export interface SignalDebugSnapshot {
  readonly id: number;
  readonly name: string;
  readonly kind: SignalDebugKind;
  readonly lastChangedEpoch: number;
  readonly lastWrite: SignalWriteDebugInfo | null;
  readonly dependencies: readonly string[];
  readonly subscribers: readonly string[];
}

export interface SignalDebugDumpOptions {
  readonly direction?: "dependencies" | "subscribers" | "both";
  readonly depth?: number;
}

function nextNodeId(): number {
  return nextDebugId++;
}

function fallbackName(kind: SignalDebugKind, id: number): string {
  return `${kind}#${id}`;
}

function describeNode(node: DebugNode): string {
  return `${node.kind}(${node.name})`;
}

function computedDependency(dependency: SignalNode): Computation {
  return dependency as unknown as Computation;
}

function registerDebugNode(node: DebugNode): void {
  debugNodes.set(node.debugId, node);
}

function debugSnapshot(node: DebugNode): SignalDebugSnapshot {
  return {
    id: node.debugId,
    name: node.name,
    kind: node.kind,
    lastChangedEpoch: node.lastChangedEpoch,
    lastWrite: node.debugLastWrite(),
    dependencies: node.debugDependencies().map(describeNode),
    subscribers: node.debugSubscribers().map(describeNode),
  };
}

function captureWriteDebugInfo(
  operation: SignalWriteDebugInfo["operation"],
): SignalWriteDebugInfo | null {
  if (!traceSignalWrites) return null;

  return {
    epoch: currentEpoch,
    operation,
    stack: new Error().stack ?? null,
  };
}

function collectAncestorEpochs(
  node: Computation,
  ancestors: Map<SignalNode, number>,
): void {
  for (const dependency of node.dependencies) {
    ancestors.set(dependency, dependency.lastChangedEpoch);
    if (dependency.kind === "computed") {
      collectAncestorEpochs(computedDependency(dependency), ancestors);
    }
  }
}

type ChangeTree = Map<SignalNode, ChangeTree | null>;

function collectChangedAncestors(
  node: Computation,
  ancestorEpochs: Map<SignalNode, number>,
): ChangeTree {
  const changed: ChangeTree = new Map();

  for (const dependency of node.dependencies) {
    if (!ancestorEpochs.has(dependency)) continue;

    const previousEpoch = ancestorEpochs.get(dependency);
    if (previousEpoch === dependency.lastChangedEpoch) continue;

    if (dependency.kind === "computed") {
      changed.set(
        dependency,
        collectChangedAncestors(computedDependency(dependency), ancestorEpochs),
      );
    } else {
      changed.set(dependency, null);
    }
  }

  return changed;
}

function formatWriteDebugInfo(
  write: SignalWriteDebugInfo | null,
  indent: number,
): string {
  if (!write) return "";

  const prefix = `\n${" ".repeat(indent)}last ${write.operation}:`;
  if (!write.stack) return `${prefix} <stack unavailable>`;

  const frames = write.stack
    .split("\n")
    .slice(2, 8)
    .map((line) => line.trim())
    .filter(Boolean);

  if (frames.length === 0) return `${prefix} <stack unavailable>`;
  return `${prefix}\n${" ".repeat(indent + 2)}${frames.join(`\n${" ".repeat(indent + 2)}`)}`;
}

function formatChangeTree(tree: ChangeTree, indent = 1): string {
  let output = "";
  const prefix = `\n${" ".repeat(indent)}↳ `;

  for (const [node, subtree] of tree) {
    output += `${prefix}${describeNode(node)} changed`;
    output += formatWriteDebugInfo(node.debugLastWrite(), indent + 2);
    if (subtree && subtree.size > 0) {
      output += formatChangeTree(subtree, indent + 2);
    }
  }

  return output;
}

function maybeLogWhy(node: Computation): void {
  const snapshot = node.debugWhySnapshot;
  if (!snapshot) return;

  const changed = collectChangedAncestors(node, snapshot);
  if (changed.size === 0) {
    const message = `${describeNode(node)} executed without a changed tracked ancestor.`;
    if (node.debugTraceReport) {
      node.debugTraceReport(message);
      return;
    }
    console.info(message);
    return;
  }

  const message = `${describeNode(node)} is running because:${formatChangeTree(changed)}`;
  if (node.debugTraceReport) {
    node.debugTraceReport(message);
    return;
  }

  console.info(message);
}

function maybeCaptureWhy(node: Computation): void {
  if (!node.debugWhySnapshot) return;
  const snapshot = new Map<SignalNode, number>();
  collectAncestorEpochs(node, snapshot);
  node.debugWhySnapshot = snapshot;
}

function formatGraphNode(
  node: DebugNode,
  options: Required<SignalDebugDumpOptions>,
  visited: Set<number>,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const lines = [
    `${indent}${describeNode(node)} epoch=${node.lastChangedEpoch}`,
  ];

  if (depth >= options.depth) return lines.join("\n");
  if (visited.has(node.debugId)) {
    lines.push(`${indent}  ↳ already shown`);
    return lines.join("\n");
  }
  visited.add(node.debugId);

  if (options.direction === "dependencies" || options.direction === "both") {
    const dependencies = node.debugDependencies();
    if (dependencies.length > 0) {
      lines.push(`${indent}  dependencies:`);
      for (const dependency of dependencies) {
        lines.push(formatGraphNode(dependency, options, visited, depth + 2));
      }
    }
  }

  if (options.direction === "subscribers" || options.direction === "both") {
    const subscribers = node.debugSubscribers();
    if (subscribers.length > 0) {
      lines.push(`${indent}  subscribers:`);
      for (const subscriber of subscribers) {
        lines.push(formatGraphNode(subscriber, options, visited, depth + 2));
      }
    }
  }

  return lines.join("\n");
}

function resolveDebugNode(
  node: Signal<unknown> | Effect | undefined,
): DebugNode | undefined {
  return node as DebugNode | undefined;
}

function matchesDebugQuery(node: DebugNode, query: string | RegExp): boolean {
  if (typeof query === "string") return node.name === query;
  return query.test(node.name);
}

/**
 * Read-only reactive value. Accessing `.value` inside a `computed` or `effect`
 * automatically registers a dependency so the consumer re-runs when the signal changes.
 * Use `.peek()` to read without subscribing.
 */
export interface Signal<T> {
  /** Debug name used in dependency graph dumps. */
  readonly name: string;
  /** Get the current value. Tracks dependency if inside computed/effect. */
  readonly value: T;
  /** Get value without tracking (peek at it). */
  peek(): T;
  /** Inspect this node's current dependency/subscriber edges. */
  debug(): SignalDebugSnapshot;
}

/**
 * A signal that can be both read and written. Assigning to `.value` or calling
 * `.set()` notifies all subscribers. Typically kept private within a class and
 * exposed externally as a read-only `Signal<T>` via a getter.
 */
export interface WritableSignal<T> extends Signal<T> {
  /** Set or get the value. Setting notifies subscribers. */
  value: T;
  /** Explicitly set the value. */
  set(value: T): void;
  /** Update value using a function. */
  update(fn: (prev: T) => T): void;
}

export interface SignalOptions<T> {
  /** Human-readable name used in debug graph output. */
  name?: string;
  /** Custom equality check. Return `true` to skip notification. Default: `Object.is`. */
  equals?: (prev: T, next: T) => boolean;
}

class SignalImpl<T> implements WritableSignal<T>, SignalNode {
  readonly debugId = nextNodeId();
  readonly kind = "signal" as const;
  #value: T;
  #subscribers = new Set<Computation>();
  #equals: (prev: T, next: T) => boolean;
  #lastChangedEpoch = currentEpoch;
  #lastWrite: SignalWriteDebugInfo | null = null;
  readonly name: string;

  constructor(initialValue: T, options?: SignalOptions<T>) {
    this.#value = initialValue;
    this.#equals = options?.equals ?? Object.is;
    this.name = options?.name ?? fallbackName(this.kind, this.debugId);
    registerDebugNode(this);
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
    if (this.#equals(this.#value, newValue)) return;

    this.#value = newValue;
    this.#lastChangedEpoch = ++currentEpoch;
    this.#lastWrite = captureWriteDebugInfo("set");

    // If we're already notifying, queue this signal for later
    if (isNotifying) {
      pendingNotifications.add(this as SignalImpl<unknown>);
      return;
    }

    this._notify();
  }

  update(fn: (prev: T) => T): void {
    const nextValue = fn(this.#value);
    if (this.#equals(this.#value, nextValue)) return;

    this.#value = nextValue;
    this.#lastChangedEpoch = ++currentEpoch;
    this.#lastWrite = captureWriteDebugInfo("update");

    if (isNotifying) {
      pendingNotifications.add(this as SignalImpl<unknown>);
      return;
    }

    this._notify();
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

  get lastChangedEpoch(): number {
    return this.#lastChangedEpoch;
  }

  debugSubscribers(): readonly Computation[] {
    return Array.from(this.#subscribers);
  }

  debugDependencies(): readonly SignalNode[] {
    return [];
  }

  debugLastWrite(): SignalWriteDebugInfo | null {
    return this.#lastWrite;
  }

  debug(): SignalDebugSnapshot {
    return debugSnapshot(this);
  }
}

/**
 * Create a writable signal with an initial value.
 *
 * @param options.equals - Custom equality check. Return `true` to skip
 *   notification. Pass `() => false` to always notify (useful for stable
 *   object references that mutate internally).
 */
export function signal<T>(
  initialValue: T,
  options?: SignalOptions<T>,
): WritableSignal<T> {
  return new SignalImpl(initialValue, options);
}

/**
 * A derived signal whose value is lazily recomputed when any upstream dependency
 * changes. Use `invalidate()` to force a recomputation on the next read.
 */
export interface ComputedSignal<T> extends Signal<T> {
  /** Force recomputation even if dependencies haven't changed. */
  invalidate(): void;
  /**
   * Sever dependency edges so this computed and its closure can be GC'd.
   * After dispose, dependency signals no longer hold the computed in their
   * subscriber set, and reads return the last cached value without retracking.
   */
  dispose(): void;
}

export interface ComputedOptions {
  /** Human-readable name used in debug graph output. */
  name?: string;
}

class ComputedImpl<T> implements ComputedSignal<T>, Computation, SignalNode {
  readonly debugId = nextNodeId();
  readonly kind = "computed" as const;
  #fn: () => T;
  #value: T | undefined;
  #dirty = true;
  #computing = false;
  #disposed = false;
  #subscribers = new Set<Computation>();
  #lastChangedEpoch = currentEpoch;
  readonly name: string;
  dependencies = new Set<SignalNode>();
  debugWhySnapshot: Map<SignalNode, number> | null = null;
  debugTraceReport: ((message: string) => void) | null = null;

  constructor(fn: () => T, options?: ComputedOptions) {
    this.#fn = fn;
    this.name = options?.name ?? fallbackName(this.kind, this.debugId);
    registerDebugNode(this);
  }

  get value(): T {
    if (this.#disposed) {
      return this.#value!;
    }

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
      this.#lastChangedEpoch = currentEpoch;
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
      maybeLogWhy(this);

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
        maybeCaptureWhy(this);
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

  get lastChangedEpoch(): number {
    return this.#lastChangedEpoch;
  }

  debugSubscribers(): readonly Computation[] {
    return Array.from(this.#subscribers);
  }

  debugDependencies(): readonly SignalNode[] {
    return Array.from(this.dependencies);
  }

  debugLastWrite(): SignalWriteDebugInfo | null {
    return null;
  }

  debug(): SignalDebugSnapshot {
    return debugSnapshot(this);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    for (const dep of this.dependencies) {
      dep._unsubscribe(this);
    }
    this.dependencies.clear();
    this.#subscribers.clear();
  }
}

/**
 * Create a computed signal that derives from other signals.
 * Dependencies are automatically tracked.
 */
export function computed<T>(
  fn: () => T,
  options?: ComputedOptions,
): ComputedSignal<T> {
  return new ComputedImpl(fn, options);
}

/**
 * Handle returned by `effect()`. Call `dispose()` to stop the effect,
 * run its cleanup function, and unsubscribe from all tracked signals.
 */
export interface Effect {
  /** Debug name used in dependency graph dumps. */
  readonly name: string;
  /** Request effect execution. Scheduled effects may defer and coalesce this. */
  execute(): void;
  /** Stop the effect and clean up subscriptions. */
  dispose(): void;
  /** Cancel a pending scheduled execution without disposing dependencies. */
  cancel(): void;
  /** Inspect this node's current dependency edges. */
  debug(): SignalDebugSnapshot;
}

export interface EffectOptions {
  /** Human-readable name used in debug graph output. */
  name?: string;
  /**
   * Schedule effect execution.
   *
   * Use this for side effects that should be coalesced by an external clock,
   * such as canvas rendering on `requestAnimationFrame`.
   */
  schedule?: (execute: () => void) => void;
}

class EffectImpl implements Effect, Computation {
  readonly debugId = nextNodeId();
  readonly kind = "effect" as const;
  #fn: () => void | (() => void);
  #schedule: ((execute: () => void) => void) | null;
  #cleanup: (() => void) | void = undefined;
  #disposed = false;
  #running = false;
  #scheduled = false;
  #scheduleToken = 0;
  readonly name: string;
  dependencies = new Set<SignalNode>();
  debugWhySnapshot: Map<SignalNode, number> | null = null;
  debugTraceReport: ((message: string) => void) | null = null;

  constructor(fn: () => void | (() => void), options?: EffectOptions) {
    this.#fn = fn;
    this.#schedule = options?.schedule ?? null;
    this.name = options?.name ?? fallbackName(this.kind, this.debugId);
    registerDebugNode(this);
    this.#requestExecute();
  }

  execute(): void {
    this.#requestExecute();
  }

  #requestExecute(): void {
    if (!this.#schedule) {
      this.#executeNow();
      return;
    }

    if (this.#scheduled || this.#disposed) return;
    this.#scheduled = true;
    const token = ++this.#scheduleToken;
    this.#schedule(() => {
      if (token !== this.#scheduleToken) return;
      this.#scheduled = false;
      this.#executeNow();
    });
  }

  #executeNow(): void {
    // Prevent re-entrant execution and execution after disposal
    if (this.#disposed || this.#running) return;
    this.#running = true;

    try {
      maybeLogWhy(this);

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
        maybeCaptureWhy(this);
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
    this.#scheduled = false;
    this.#scheduleToken++;

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

  cancel(): void {
    this.#scheduled = false;
    this.#scheduleToken++;
  }

  get lastChangedEpoch(): number {
    return currentEpoch;
  }

  debugSubscribers(): readonly Computation[] {
    return [];
  }

  debugDependencies(): readonly SignalNode[] {
    return Array.from(this.dependencies);
  }

  debugLastWrite(): SignalWriteDebugInfo | null {
    return null;
  }

  debug(): SignalDebugSnapshot {
    return debugSnapshot(this);
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
export function effect(
  fn: () => void | (() => void),
  options?: EffectOptions,
): Effect {
  return new EffectImpl(fn, options);
}

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

/**
 * Explicitly track a signal as a dependency without using its value.
 *
 * Use this inside named dependency boundaries when a render/effect only needs
 * to rerun after a signal changes. Outside a reactive context this is a no-op
 * read with the same semantics as `.value`.
 */
export function track(signal: Signal<unknown>): void {
  signal.value;
}

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

export interface ReactiveRunTraceOptions {
  /** Override the default console reporter. Useful for tests and custom debug UIs. */
  report?: (message: string) => void;
}

/**
 * Trace why the current computed or effect runs.
 *
 * Call inside a reactive body. The first call arms the computation; subsequent
 * executions log which tracked ancestors changed since the previous run.
 */
export function traceReactiveRun(options?: ReactiveRunTraceOptions): void {
  if (!currentComputation) {
    throw new Error("traceReactiveRun() called outside of a reactive context");
  }

  currentComputation.debugTraceReport = options?.report ?? null;
  if (!currentComputation.debugWhySnapshot) {
    currentComputation.debugWhySnapshot = new Map();
  }
}

/**
 * Development helper for inspecting the signal dependency graph.
 */
export const signalDebug = {
  traceWrites(enabled = true): void {
    traceSignalWrites = enabled;
  },

  dump(
    node?: Signal<unknown> | Effect,
    options?: SignalDebugDumpOptions,
  ): string {
    const resolvedOptions: Required<SignalDebugDumpOptions> = {
      direction: options?.direction ?? "both",
      depth: options?.depth ?? 4,
    };

    const root = resolveDebugNode(node);
    if (root) {
      return formatGraphNode(root, resolvedOptions, new Set(), 0);
    }

    return Array.from(debugNodes.values())
      .map((debugNode) =>
        formatGraphNode(debugNode, resolvedOptions, new Set(), 0),
      )
      .join("\n\n");
  },

  dumpByName(query: string | RegExp, options?: SignalDebugDumpOptions): string {
    const resolvedOptions: Required<SignalDebugDumpOptions> = {
      direction: options?.direction ?? "both",
      depth: options?.depth ?? 4,
    };

    const matches = Array.from(debugNodes.values()).filter((node) =>
      matchesDebugQuery(node, query),
    );
    if (matches.length === 0)
      return `No signal debug nodes matched ${String(query)}.`;

    return matches
      .map((debugNode) =>
        formatGraphNode(debugNode, resolvedOptions, new Set(), 0),
      )
      .join("\n\n");
  },

  find(query: string | RegExp): readonly SignalDebugSnapshot[] {
    return Array.from(debugNodes.values())
      .filter((node) => matchesDebugQuery(node, query))
      .map(debugSnapshot);
  },

  log(node?: Signal<unknown> | Effect, options?: SignalDebugDumpOptions): void {
    console.info(this.dump(node, options));
  },

  logByName(query: string | RegExp, options?: SignalDebugDumpOptions): void {
    console.info(this.dumpByName(query, options));
  },

  list(): readonly SignalDebugSnapshot[] {
    return Array.from(debugNodes.values()).map(debugSnapshot);
  },
};
