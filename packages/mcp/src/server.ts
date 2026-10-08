import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { FastifyInstance } from "fastify";
import * as z from "zod/v4";
import {
  shiftInputSchemas,
  type ShiftCapture,
  type ShiftCaptureInput,
  type ShiftObservation,
} from "@shift/runtime";
import { SHIFT_CODE_TYPES } from "./declarations";
import { SHIFT_GUIDE_TOPICS, SHIFT_MCP_INSTRUCTIONS, shiftGuide } from "./guide";
import type { ShiftMcpActivity, ShiftMcpConnection } from "./types";

const LOOPBACK_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";
/** How long a client that introduced itself still counts as active. */
const CLIENT_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

export interface ShiftMcpLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface ShiftMcpServerOptions {
  execute(code: string): Promise<unknown>;
  capture(input: ShiftCaptureInput): Promise<ShiftObservation<ShiftCapture>>;
  port: number;
  logger?: ShiftMcpLogger;
  /** Called after each accepted request with the updated activity summary. */
  onActivity?: (activity: ShiftMcpActivity) => void;
  /** Injectable clock for activity timestamps. */
  now?: () => number;
}

/**
 * Serves code-mode access to one running Shift application over loopback HTTP.
 *
 * @remarks
 * There is no credential. The server listens on `127.0.0.1` only, and the MCP
 * SDK's localhost guards reject a foreign `Host` (DNS rebinding) and any
 * browser `Origin` that is not localhost. The host decides when the server
 * runs; Shift starts it only while agent connections are allowed.
 */
export class ShiftMcpServer {
  readonly #execute: (code: string) => Promise<unknown>;
  readonly #capture: ShiftMcpServerOptions["capture"];
  readonly #port: number;
  readonly #logger: ShiftMcpLogger | undefined;
  readonly #onActivity: ShiftMcpServerOptions["onActivity"];
  readonly #now: () => number;
  #httpServer: FastifyInstance | null = null;
  #closeHandler: (() => Promise<void>) | null = null;
  #connection: ShiftMcpConnection | null = null;
  #lastRequestAt: number | null = null;
  // non-reactive: plain bookkeeping read only to build activity snapshots
  readonly #clients = new Map<string, number>();

  /**
   * Creates an unstarted server bound to a host-owned isolated executor.
   *
   * @param options - execution and capture callbacks, port, and optional diagnostics and activity sinks.
   */
  constructor(options: ShiftMcpServerOptions) {
    this.#execute = options.execute;
    this.#capture = options.capture;
    this.#port = options.port;
    this.#logger = options.logger;
    this.#onActivity = options.onActivity;
    this.#now = options.now ?? Date.now;
  }

  /** Recent agent activity: the last request time and clients seen in the activity window. */
  get activity(): ShiftMcpActivity {
    const cutoff = this.#now() - CLIENT_ACTIVITY_WINDOW_MS;
    const clients = [...this.#clients]
      .filter(([, lastSeenAt]) => lastSeenAt >= cutoff)
      .map(([name, lastSeenAt]) => ({ name, lastSeenAt }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return { lastRequestAt: this.#lastRequestAt, clients };
  }

  /** Starts the loopback server; resolves with its URL. */
  async start(): Promise<ShiftMcpConnection> {
    if (this.#connection) return this.#connection;

    const handler = createMcpHandler(() => this.#createProtocolServer());
    const nodeHandler = toNodeHandler(handler, {
      maxRequestBodySize: 128 * 1024,
      onerror: (error) => this.#logger?.error("MCP request failed", error),
    });
    const httpServer = createMcpFastifyApp();
    httpServer.all(MCP_PATH, { bodyLimit: 128 * 1024 }, async (request, reply) => {
      this.#recordActivity(request.body);
      reply.hijack();
      await nodeHandler(request.raw, reply.raw, request.body);
    });

    try {
      await httpServer.listen({ host: LOOPBACK_HOST, port: this.#port });
      const address = httpServer.server.address();
      if (!address || typeof address === "string")
        throw new Error("Shift MCP server has no TCP port");
      const connection = {
        url: `http://${LOOPBACK_HOST}:${address.port}${MCP_PATH}`,
      } satisfies ShiftMcpConnection;

      this.#httpServer = httpServer;
      this.#closeHandler = handler.close;
      this.#connection = connection;
      this.#logger?.info("MCP server started", { url: connection.url });
      return connection;
    } catch (error) {
      await httpServer.close();
      await handler.close();
      throw error;
    }
  }

  /** Stops accepting requests and forgets recent activity. */
  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const closeHandler = this.#closeHandler;
    const connection = this.#connection;
    this.#httpServer = null;
    this.#closeHandler = null;
    this.#connection = null;
    this.#lastRequestAt = null;
    this.#clients.clear();

    if (httpServer) await httpServer.close();
    if (closeHandler) await closeHandler();
    if (connection) this.#logger?.info("MCP server stopped");
  }

  #recordActivity(body: unknown): void {
    const now = this.#now();
    this.#lastRequestAt = now;
    const clientName = initializeClientName(body);
    if (clientName) this.#clients.set(clientName, now);
    this.#onActivity?.(this.activity);
  }

  #createProtocolServer(): McpServer {
    const server = new McpServer(
      { name: "shift", version: "0.1.0" },
      { instructions: SHIFT_MCP_INSTRUCTIONS },
    );
    server.registerTool(
      "shift.guide",
      {
        description:
          "Read the Shift skill for this build: when to use the live MCP or shift-cli, and how to interpret fonts. Start with the overview.",
        inputSchema: z.object({
          topic: z
            .enum(SHIFT_GUIDE_TOPICS)
            .default("overview")
            .describe("Skill section to read; the overview lists the others."),
        }),
      },
      async ({ topic }) => ({
        content: [{ type: "text", text: shiftGuide(topic) }],
      }),
    );
    server.registerTool(
      "shift.describe",
      {
        description: "Describe the typed live Shift API available to shift.execute.",
        inputSchema: z.object({}),
      },
      async () => ({
        content: [{ type: "text", text: SHIFT_CODE_TYPES }],
      }),
    );
    server.registerTool(
      "shift.capture",
      {
        description:
          "Capture a point-in-time PNG of one explicit Shift window or its editor canvas.",
        inputSchema: shiftInputSchemas.capture,
      },
      async (input) => {
        const observation = await this.#capture(input);
        const { data, ...capture } = observation.value;
        const metadata = { fontRevision: observation.fontRevision, value: capture };
        return {
          content: [
            { type: "image", data, mimeType: observation.value.mimeType },
            { type: "text", text: JSON.stringify(metadata, null, 2) },
          ],
        };
      },
    );
    server.registerTool(
      "shift.execute",
      {
        description: `Execute an async JavaScript function against the live Shift API. Return a JSON value.\n\n${SHIFT_CODE_TYPES}`,
        inputSchema: z.object({
          code: z
            .string()
            .min(1)
            .max(16_384)
            .describe(
              "An async zero-argument function, for example async () => await shift.sessions.list()",
            ),
        }),
      },
      async ({ code }) => {
        const result = await this.#execute(code);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    );
    return server;
  }
}

/** The `clientInfo.name` of an MCP `initialize` request, or `null` for any other body. */
function initializeClientName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { method, params } = body as {
    method?: unknown;
    params?: { clientInfo?: { name?: unknown } };
  };
  if (method !== "initialize") return null;
  const name = params?.clientInfo?.name;
  return typeof name === "string" && name.length > 0 ? name.slice(0, 120) : null;
}
