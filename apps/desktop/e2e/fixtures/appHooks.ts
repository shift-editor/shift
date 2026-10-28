import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type {
  AgentReaderName,
  AgentReadArgs,
  AgentReadMethod,
  AgentReadResult,
} from "@/agent/AgentReaders";
import type { E2EActionArgs, E2EActionName, E2EActionResult } from "@/testing/E2EActions";
import type {} from "../../src/main/agent/e2eAgentReads";

// The one file where specs and fixtures reach into the running app: the E2E
// hooks main publishes for test launches. `shiftAgentReads` calls the window's
// agent readers, the ones agents read through MCP; `shiftE2EActions` runs the
// renderer's setup actions, whose `draw` is the builder `TestEditor` runs
// in-process. Both are typed from the app's own code, so a renamed method or a
// changed signature fails typecheck here.
// `shift/no-page-evaluate-in-specs` exempts this file and no other.

const windowIds = new WeakMap<Page, Promise<number>>();

/** The id main gives the window that owns `page`, once its agent lane is connected. */
async function connectedWindowId(app: ElectronApplication, page: Page): Promise<number> {
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
  app: ElectronApplication,
  page: Page,
  reader: R,
  method: M,
  args: AgentReadArgs<R, M>,
): Promise<AgentReadResult<R, M>> {
  const windowId = await connectedWindowId(app, page);
  const call = { windowId, reader, method: String(method), args };
  const value = await app.evaluate(async (_electron, { windowId, reader, method, args }) => {
    const reads = globalThis.shiftAgentReads;
    if (!reads) throw new Error("The app has no E2E agent reads; is NODE_ENV test?");
    return reads.read(windowId, reader, method, args);
  }, call);
  return value as AgentReadResult<R, M>;
}

/**
 * Runs the setup action `action` (`testing/E2EActions.ts`) in `page`'s window; it waits until
 * the workspace confirms its edits.
 *
 * @throws {Error} when the app was not launched for E2E, or the action fails in the renderer.
 */
export async function actInApp<A extends E2EActionName>(
  app: ElectronApplication,
  page: Page,
  action: A,
  args: E2EActionArgs<A>,
): Promise<E2EActionResult<A>> {
  const windowId = await connectedWindowId(app, page);
  const value = await app.evaluate(
    async (_electron, { windowId, action, args }) => {
      const actions = globalThis.shiftE2EActions;
      if (!actions) throw new Error("The app has no E2E actions; is NODE_ENV test?");
      return actions.act(windowId, action, args);
    },
    { windowId, action: String(action), args },
  );
  return value as E2EActionResult<A>;
}

/** {@link actInApp} for each setup action, bound to one window. */
export type E2ESetup = {
  readonly [A in E2EActionName]: (...args: E2EActionArgs<A>) => Promise<E2EActionResult<A>>;
};

/** The setup actions of `page`'s window, as methods that run them there. */
export function setupActions(app: ElectronApplication, page: Page): E2ESetup {
  return new Proxy({} as E2ESetup, {
    get:
      (_target, action) =>
      (...args: unknown[]) =>
        actInApp(app, page, action as E2EActionName, args as never),
  });
}
