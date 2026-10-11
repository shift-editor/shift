/**
 * Counts React component renders per commit in a running Shift window.
 *
 * @remarks
 * Re-render budgets catch the regressions frame timing hides on fast machines:
 * a subscription that re-renders a sidebar on every scrub step costs little on
 * an M-series Mac and drops frames on a Linux laptop. Counts do not depend on
 * the GPU, so they hold in software-rendered CI. Shared with
 * `scripts/profile-desktop.mjs`, which prints the same report.
 */
import type { Page } from "@playwright/test";

/** What the counter saw between {@link startRenderCount} and {@link stopRenderCount}. */
export interface RenderCount {
  commits: number;
  /** Mean component renders per React commit. */
  perCommit: number;
  /**
   * Re-rendered subtrees by the component that started them and what changed
   * (`hook#N` slot or `context {…}`), most frequent first.
   */
  starts: [string, number][];
}

declare global {
  interface Window {
    __shiftRenders?: { start(): void; stop(): RenderCount };
  }
}

/**
 * Installs the counter and reloads, since React reads the DevTools hook once at startup.
 *
 * @param waitForReady - waits for the reloaded window to be usable again.
 */
export async function installRenderCounter(
  page: Page,
  waitForReady: () => Promise<void>,
): Promise<void> {
  await page.context().addInitScript({ content: renderCounterInitScript() });
  await page.reload();
  await page.waitForFunction(() => window.__shiftRenders !== undefined);
  await waitForReady();
}

export async function startRenderCount(page: Page): Promise<void> {
  await page.evaluate(() => window.__shiftRenders?.start());
}

export async function stopRenderCount(page: Page): Promise<RenderCount> {
  return page.evaluate(() => {
    if (!window.__shiftRenders) throw new Error("the render counter is not installed");
    return window.__shiftRenders.stop();
  });
}

/**
 * The counter as init-script source.
 *
 * @remarks
 * Transpilers that keep function names (esbuild's `keepNames`, which tsx uses)
 * wrap functions in a `__name` helper that does not exist in the page, so the
 * script defines a no-op one first.
 */
export function renderCounterInitScript(): string {
  return `var __name = (target) => target;\n(${renderCounterScript.toString()})();`;
}

/**
 * Runs in the page. Attributes each re-rendered subtree to the hook state or
 * context change that started it.
 */
export function renderCounterScript(): void {
  type Fiber = {
    tag: number;
    type: unknown;
    flags: number;
    child: Fiber | null;
    sibling: Fiber | null;
    alternate: Fiber | null;
    memoizedState: Hook | null;
    dependencies: { firstContext: ContextDependency | null } | null;
  };
  type Hook = { memoizedState: unknown; queue: unknown; next: Hook | null };
  type ContextDependency = {
    context: { displayName?: string };
    memoizedValue: unknown;
    next: ContextDependency | null;
  };
  type NamedType = {
    displayName?: string;
    name?: string;
    render?: NamedType;
    type?: NamedType;
  };
  type DevToolsHook = {
    renderers: Map<number, unknown>;
    supportsFiber: boolean;
    inject(renderer: unknown): number;
    onScheduleFiberRoot(): void;
    onCommitFiberUnmount(): void;
    onPostCommitFiberRoot(): void;
    onCommitFiberRoot?: (id: number, root: { current: Fiber }) => void;
  };

  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const CLASS_COMPONENT = 1;
  const PERFORMED_WORK = 1;
  const starts = new Map<string, number>();
  const state = { active: false, commits: 0, renders: 0 };

  const nameOf = (fiber: Fiber): string | null => {
    const type = fiber.type as NamedType | string | null;
    if (!type || typeof type === "string") return null;
    const inner = type.render ?? type.type ?? type;
    return type.displayName ?? inner.displayName ?? inner.name ?? null;
  };
  const contextName = (dependency: ContextDependency): string => {
    if (dependency.context.displayName) return dependency.context.displayName;
    const value = dependency.memoizedValue;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).slice(0, 4).join(",")}}`;
    }
    return typeof value;
  };
  const reasons = (fiber: Fiber, previous: Fiber): string => {
    const found: string[] = [];
    // Hook slots, in order. useSignalState (useSyncExternalStore) takes two slots.
    if (fiber.tag !== CLASS_COMPONENT) {
      let before = previous.memoizedState;
      let after = fiber.memoizedState;
      for (let slot = 0; before && after && slot < 100; slot++) {
        const value = after.memoizedState;
        const isEffect =
          value !== null && typeof value === "object" && "deps" in value && "create" in value;
        if (!isEffect && after.queue && !Object.is(before.memoizedState, value)) {
          found.push(`hook#${slot}`);
        }
        before = before.next;
        after = after.next;
      }
    }
    let before = previous.dependencies?.firstContext ?? null;
    let after = fiber.dependencies?.firstContext ?? null;
    for (; before && after; before = before.next, after = after.next) {
      if (!Object.is(before.memoizedValue, after.memoizedValue)) {
        found.push(`context ${contextName(after)}`);
      }
    }
    return found.join(" ") || "?";
  };
  // React leaves PerformedWork set on fibers in subtrees it skipped, so only walk
  // into children it reconciled this commit (their child pointer changed).
  const visit = (first: Fiber | null, parentRendered: boolean): void => {
    for (let fiber = first; fiber; fiber = fiber.sibling) {
      const previous = fiber.alternate;
      const isComponent = COMPONENT_TAGS.has(fiber.tag);
      const rendered = isComponent && (!previous || (fiber.flags & PERFORMED_WORK) !== 0);
      if (rendered) {
        state.renders++;
        if (!parentRendered) {
          const cause = previous ? reasons(fiber, previous) : "mount";
          const key = `${nameOf(fiber) ?? "(anonymous)"}  ←  ${cause}`;
          starts.set(key, (starts.get(key) ?? 0) + 1);
        }
      }
      if (fiber.child && (!previous || fiber.child !== previous.child)) {
        visit(fiber.child, isComponent ? rendered : parentRendered);
      }
    }
  };

  const global = window as unknown as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook;
    __shiftRenders?: { start(): void; stop(): RenderCount };
  };
  const hook: DevToolsHook = (global.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  });
  hook.onCommitFiberRoot = (_id, root) => {
    if (!state.active) return;
    state.commits++;
    const current = root.current;
    if (current.alternate && current.child === current.alternate.child) return;
    visit(current.child, false);
  };
  global.__shiftRenders = {
    start() {
      starts.clear();
      Object.assign(state, { active: true, commits: 0, renders: 0 });
    },
    stop() {
      state.active = false;
      return {
        commits: state.commits,
        perCommit: Math.round(state.renders / Math.max(1, state.commits)),
        starts: [...starts].sort((a, b) => b[1] - a[1]).slice(0, 25),
      };
    },
  };
}
