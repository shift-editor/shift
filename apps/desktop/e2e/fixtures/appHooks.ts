import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { AppReaders } from "@/agent/AppReaders";
import type { E2EHooks } from "@/testing/e2e/hooks";
import type {} from "../../src/main/agent/e2eHooks";

// The one file where the test process reaches into the running app, through
// the E2E hooks main publishes for test launches. `readsOf(page)` calls the
// window's app readers, the read layer MCP agents read too; `hooksOf(page)`
// calls the renderer's test hooks (`testing/e2e/`): the test surface's actions,
// shared with `TestEditor`, and the few canvas and session facts no reader
// serves. Both are typed from the app's own classes, so a call reads like a
// method call and a renamed method fails typecheck. `shift/no-page-evaluate-in-specs`
// exempts this file and no other.

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
      app.evaluate((_electron, id) => globalThis.shiftAppReads?.connected(id) ?? false, id),
    )
    .toBe(true);
  return id;
}

/**
 * `T`'s objects as seen from the test process: each method takes the same arguments and
 * resolves to what it returns, once the call has run in the window.
 */
export type Remote<T> = {
  readonly [K in keyof T]: {
    readonly [M in keyof T[K] as T[K][M] extends (...args: never[]) => unknown
      ? M
      : never]: T[K][M] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : never;
  };
};

/**
 * The app's readers (`agent/AppReaders.ts`) in `page`'s window: the read layer MCP agents read
 * too. Each read runs once the window's pending edits settle.
 *
 * @throws {Error} on a call, when the app was not launched for E2E or the read fails in the renderer.
 */
export function readsOf(page: Page): Remote<AppReaders> {
  return remote(page, async (windowId, reader, method, args) =>
    appFor(page).evaluate(
      async (_electron, call) => {
        const reads = globalThis.shiftAppReads;
        if (!reads) throw new Error("The app has no E2E reads; is NODE_ENV test?");
        return reads.read(call.windowId, call.reader, call.method, call.args);
      },
      { windowId, reader, method, args },
    ),
  );
}

/**
 * The renderer's E2E hooks (`testing/e2e/hooks.ts`) in `page`'s window. Actions answer once the
 * workspace confirms their edits; the rest answer at once.
 *
 * @throws {Error} on a call, when the app was not launched for E2E or the call fails in the renderer.
 */
export function hooksOf(page: Page): Remote<E2EHooks> {
  return remote(page, async (windowId, hook, method, args) =>
    appFor(page).evaluate(
      async (_electron, call) => {
        const hooks = globalThis.shiftE2EHooks;
        if (!hooks) throw new Error("The app has no E2E hooks; is NODE_ENV test?");
        return hooks.call(call.windowId, call.hook, call.method, call.args);
      },
      { windowId, hook, method, args },
    ),
  );
}

/** Turns `object.method(...args)` into `send(windowId, object, method, args)` for `page`'s window. */
function remote<T>(
  page: Page,
  send: (windowId: number, object: string, method: string, args: unknown[]) => Promise<unknown>,
): Remote<T> {
  return new Proxy({} as Remote<T>, {
    get: (_target, object) =>
      new Proxy(
        {},
        {
          // Answer `then` with nothing, so awaiting a reader by mistake does not send a call.
          get: (_methods, method) =>
            method === "then"
              ? undefined
              : async (...args: unknown[]) =>
                  send(await connectedWindowId(page), String(object), String(method), args),
        },
      ),
  });
}
