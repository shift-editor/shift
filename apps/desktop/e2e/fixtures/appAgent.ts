import type { ElectronApplication, Page } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * Runs read code against one window of the running app through its local MCP
 * server, the public path agents use.
 *
 * @remarks
 * The first call allows agent connections, as Settings › Agents does, and
 * learns the server's URL. Each call then runs `shift.execute` with an async
 * function that receives the window's id as `windowId`, so tests read exactly
 * what an agent reads: the window's agent readers, settled and
 * revision-checked by the renderer's `AgentBridge`.
 */
export class AppAgent {
  readonly #page: Page;
  readonly #app: ElectronApplication | null;
  #url: Promise<string> | null = null;
  #windowId: Promise<number> | null = null;

  /**
   * @param app - The app that owns `page`; needed to tell its window apart
   * when more than one font window is open.
   */
  constructor(page: Page, app: ElectronApplication | null) {
    this.#page = page;
    this.#app = app;
  }

  /**
   * Runs `body` as the body of an async function in the app's script runtime
   * and returns its JSON result.
   *
   * @param body - Script statements; `shift`, `windowId` (this page's window)
   * and `input` are in scope.
   * @param input - A JSON value bound as `input` in the script.
   */
  async run<T>(body: string, input: unknown = null): Promise<T> {
    const windowId = await this.#resolveWindowId();
    return this.#execute<T>(
      `async () => {
        const windowId = ${JSON.stringify(windowId)};
        const input = ${JSON.stringify(input)};
        ${body}
      }`,
    );
  }

  async #execute<T>(code: string): Promise<T> {
    this.#url ??= this.#allowConnections();
    const client = new Client({ name: "shift-e2e-driver", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(await this.#url));

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "shift.execute", arguments: { code } });
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      if (result.isError) throw new Error(text);
      return JSON.parse(text) as T;
    } finally {
      await client.close();
    }
  }

  #resolveWindowId(): Promise<number> {
    this.#windowId ??= this.#findWindowId();
    return this.#windowId;
  }

  async #findWindowId(): Promise<number> {
    if (this.#app) {
      const window = await this.#app.browserWindow(this.#page);
      return window.evaluate((browserWindow) => browserWindow.id);
    }

    const sessions = await this.#execute<{ windowId: number }[]>(
      "async () => await shift.sessions.list()",
    );
    if (sessions.length !== 1) {
      throw new Error(
        `Expected one font window, found ${sessions.length}; pass the app to the driver`,
      );
    }
    return sessions[0]!.windowId;
  }

  async #allowConnections(): Promise<string> {
    const state = await this.#page.evaluate(async () => {
      const connections = window.shiftHost?.agentConnections;
      if (!connections) throw new Error("Expected the Shift host");
      return connections.setAllowed(true);
    });
    if (state.status !== "listening") {
      throw new Error(`Agent connections did not start: ${state.error ?? state.status}`);
    }
    return state.url;
  }
}
