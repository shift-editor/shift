import type { AgentClient } from "./AgentClient";

/**
 * Direct reads of one window's agent readers, for the Playwright `EditorDriver`.
 *
 * @remarks
 * Published on `globalThis.shiftAgentReads` only for E2E launches
 * (`NODE_ENV=test`), so tests read what agents read without the local MCP
 * server: no agent connection, no script runtime. A call reaches the window's
 * `AgentClient`, and the renderer's `AgentBridge` answers it from the reader
 * named `reader` once pending edits settle.
 */
export interface E2EAgentReads {
  /**
   * Calls `reader`'s `method` with `args` in window `windowId`'s renderer.
   *
   * @returns the method's plain result.
   * @throws {Error} when the window has no font session, or the reader or method is unknown.
   */
  read(windowId: number, reader: string, method: string, args: unknown[]): Promise<unknown>;
}

declare global {
  var shiftAgentReads: E2EAgentReads | undefined;
}

/**
 * Publishes {@link E2EAgentReads} when this is an E2E launch; does nothing otherwise.
 *
 * @param agentFor - The agent lane of window `windowId`; throws for a window without a font session.
 */
export function publishE2EAgentReads(agentFor: (windowId: number) => AgentClient): void {
  if (process.env.NODE_ENV !== "test") return;

  globalThis.shiftAgentReads = {
    read: (windowId, reader, method, args) => agentFor(windowId).read(reader, method, args),
  };
}
