import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type {
  AgentReaderName,
  AgentReadArgs,
  AgentReadMethod,
  AgentReadResult,
} from "@/agent/AgentReaders";
import type { E2EHookArgs, E2EHookMethod, E2EHookName, E2EHookResult } from "@/testing/e2e/hooks";
import type {} from "../../src/main/agent/e2eAgentReads";

// The one file where specs and fixtures reach into the running app: the E2E
// hooks main publishes for test launches. `shiftAgentReads` calls the window's
// agent readers, the ones agents read through MCP; `shiftE2EHooks` calls the
// renderer's test hooks (`testing/e2e/`): setup actions, whose `draw` is the
// builder `TestEditor` runs in-process, and probes of state agents do not read.
// Both are typed from the app's own code, so a renamed method or a changed
// signature fails typecheck here. `shift/no-page-evaluate-in-specs` exempts
// this file and no other.

const apps = new WeakMap<Page, ElectronApplication>();
const registered = new WeakSet<ElectronApplication>();
const windowIds = new WeakMap<Page, Promise<number>>();

/** Records `app` as the owner of every window it has open or opens later. */
export function registerApp(app: ElectronApplication): void {
  if (registered.has(app)) return;
  registered.add(app);
  for (const page of app.windows()) apps.set(page, app);
  app.on("window", (page) => apps.set(page, app));
}

/** The app that owns `page`; throws for a page no registered launch opened. */
export function appFor(page: Page): ElectronApplication {
  const app = apps.get(page);
  if (!app) throw new Error("This page's app was not launched through the E2E fixtures");
  return app;
}

/** The id main gives the window that owns `page`, once its agent lane is connected. */
async function connectedWindowId(page: Page): Promise<number> {
  const app = appFor(page);
  let windowId = windowIds.get(page);
  if (!windowId) {
    windowId = app
      .browserWindow(page)
      .then((window) => window.evaluate((browserWindow) => browserWindow.id));
    windowIds.set(page, windowId);
  }
  const id = await windowId;
  // A window that just opened or reloaded answers once its renderer connects the agent lane.
  await expect
    .poll(() =>
      app.evaluate((_electron, id) => globalThis.shiftAgentReads?.connected(id) ?? false, id),
    )
    .toBe(true);
  return id;
}

/**
 * Calls `reader`'s `method` in `page`'s window once its pending edits settle.
 *
 * @throws {Error} when the app was not launched for E2E, or the read fails in the renderer.
 */
export async function readAgent<R extends AgentReaderName, M extends AgentReadMethod<R>>(
  page: Page,
  reader: R,
  method: M,
  args: AgentReadArgs<R, M>,
): Promise<AgentReadResult<R, M>> {
  const windowId = await connectedWindowId(page);
  const call = { windowId, reader, method: String(method), args };
  const value = await appFor(page).evaluate(
    async (_electron, { windowId, reader, method, args }) => {
      const reads = globalThis.shiftAgentReads;
      if (!reads) throw new Error("The app has no E2E agent reads; is NODE_ENV test?");
      return reads.read(windowId, reader, method, args);
    },
    call,
  );
  return value as AgentReadResult<R, M>;
}

/**
 * Calls `hook`'s `method` (`testing/e2e/hooks.ts`) in `page`'s window. Setup actions wait until
 * the workspace confirms their edits; probes answer at once.
 *
 * @throws {Error} when the app was not launched for E2E, or the call fails in the renderer.
 */
export async function callHook<H extends E2EHookName, M extends E2EHookMethod<H>>(
  page: Page,
  hook: H,
  method: M,
  ...args: E2EHookArgs<H, M>
): Promise<E2EHookResult<H, M>> {
  const windowId = await connectedWindowId(page);
  const call = { windowId, hook, method: String(method), args };
  const value = await appFor(page).evaluate(async (_electron, { windowId, hook, method, args }) => {
    const hooks = globalThis.shiftE2EHooks;
    if (!hooks) throw new Error("The app has no E2E hooks; is NODE_ENV test?");
    return hooks.call(windowId, hook, method, args);
  }, call);
  return value as E2EHookResult<H, M>;
}

/** The setup actions of one window, as methods that run them there. */
export type E2ESetup = {
  readonly [M in E2EHookMethod<"actions">]: (
    ...args: E2EHookArgs<"actions", M>
  ) => Promise<E2EHookResult<"actions", M>>;
};

/** The setup actions of `page`'s window (`testing/e2e/E2EActions.ts`). */
export function setupActions(page: Page): E2ESetup {
  return new Proxy({} as E2ESetup, {
    get:
      (_target, method) =>
      (...args: unknown[]) =>
        callHook(page, "actions", method as E2EHookMethod<"actions">, ...(args as never)),
  });
}
