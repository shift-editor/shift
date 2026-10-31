import type { AgentClient } from "./AgentClient";

/**
 * Direct reads of one window's app readers (`AppReaders`), for the Playwright `EditorDriver`.
 *
 * @remarks
 * Published on `globalThis.shiftAppReads` only for E2E launches
 * (`NODE_ENV=test`), so tests read through the same read layer MCP agents use,
 * without the local MCP server: no agent connection, no script runtime. A call reaches the window's
 * `AgentClient`, and the renderer's `AgentBridge` answers it from the reader
 * named `reader` once pending edits settle.
 */
export interface E2EAppReads {
  /**
   * Calls `reader`'s `method` with `args` in window `windowId`'s renderer.
   *
   * @returns the method's plain result.
   * @throws {Error} when the window has no font session, or the reader or method is unknown.
   */
  read(windowId: number, reader: string, method: string, args: unknown[]): Promise<unknown>;
  /**
   * Whether window `windowId`'s renderer has connected its agent lane, so a read can reach it;
   * false for a window without a font session.
   */
  connected(windowId: number): boolean;
}

/**
 * Setup actions and test probes in one window's renderer, for the Playwright
 * `EditorDriver` and fixtures: the hooks in the renderer's `testing/e2e/`.
 * Their `actions.draw` is the builder `TestEditor.draw` runs in-process, so
 * both drivers set up alike.
 *
 * @remarks
 * Published on `globalThis.shiftE2EHooks` only for E2E launches, with
 * {@link E2EAppReads}. Actions settle before they resolve.
 */
export interface E2EHooksBridge {
  /**
   * Calls `hook`'s `method` with `args` in window `windowId`'s renderer.
   *
   * @returns the method's plain result.
   * @throws {Error} when the window has no font session, or the hook or method is unknown.
   */
  call(windowId: number, hook: string, method: string, args: unknown[]): Promise<unknown>;
}

declare global {
  var shiftAppReads: E2EAppReads | undefined;
  var shiftE2EHooks: E2EHooksBridge | undefined;
}

/**
 * Publishes {@link E2EAppReads} and {@link E2EHooksBridge} when this is an E2E
 * launch; does nothing otherwise.
 *
 * @param agentFor - The agent lane of window `windowId`; throws for a window without a font session.
 */
export function publishE2EHooks(agentFor: (windowId: number) => AgentClient): void {
  if (process.env.NODE_ENV !== "test") return;

  globalThis.shiftAppReads = {
    read: (windowId, reader, method, args) => agentFor(windowId).read(reader, method, args),
    connected: (windowId) => {
      try {
        return agentFor(windowId).connected;
      } catch {
        return false;
      }
    },
  };
  globalThis.shiftE2EHooks = {
    call: (windowId, hook, method, args) => agentFor(windowId).callHook(hook, method, args),
  };
}
