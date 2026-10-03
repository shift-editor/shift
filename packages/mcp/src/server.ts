import { randomBytes, timingSafeEqual } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SHIFT_CODE_TYPES } from "./declarations";
import type { ShiftMcpConnection } from "./types";

const LOOPBACK_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";

export interface ShiftMcpLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface ShiftMcpServerOptions {
  execute(code: string): Promise<unknown>;
  descriptorPath: string;
  logger?: ShiftMcpLogger;
}

/** Serves code-mode access to one running Shift application over loopback HTTP. */
export class ShiftMcpServer {
  readonly #execute: (code: string) => Promise<unknown>;
  readonly #descriptorPath: string;
  readonly #logger: ShiftMcpLogger | undefined;
  #httpServer: Server | null = null;
  #closeHandler: (() => Promise<void>) | null = null;
  #connection: ShiftMcpConnection | null = null;

  /**
   * Creates an unstarted server bound to a host-owned isolated executor.
   *
   * @param options - execution callback, private descriptor path, and optional diagnostics sink.
   */
  constructor(options: ShiftMcpServerOptions) {
    this.#execute = options.execute;
    this.#descriptorPath = options.descriptorPath;
    this.#logger = options.logger;
  }

  /** Starts a random loopback port and publishes same-user connection details. */
  async start(): Promise<ShiftMcpConnection> {
    if (this.#connection) return this.#connection;

    const token = randomBytes(32).toString("base64url");
    const handler = createMcpHandler(() => this.#createProtocolServer());
    const nodeHandler = toNodeHandler(handler, {
      maxRequestBodySize: 128 * 1024,
      onerror: (error) => this.#logger?.error("MCP request failed", error),
    });
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();
    const httpServer = createServer((request, response) => {
      if (!validateHost(request, response) || !validateOrigin(request, response)) return;

      const requestPath = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`).pathname;
      if (requestPath !== MCP_PATH) {
        response.writeHead(404).end();
        return;
      }

      if (!hasBearerToken(request.headers.authorization, token)) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid Shift MCP connection secret" }));
        return;
      }

      void nodeHandler(request, response);
    });

    try {
      const port = await listen(httpServer);
      const connection = {
        url: `http://${LOOPBACK_HOST}:${port}${MCP_PATH}`,
        token,
        descriptorPath: this.#descriptorPath,
      } satisfies ShiftMcpConnection;

      await publishConnection(connection);
      this.#httpServer = httpServer;
      this.#closeHandler = handler.close;
      this.#connection = connection;
      this.#logger?.info("MCP server started", { url: connection.url });
      return connection;
    } catch (error) {
      httpServer.close();
      await handler.close();
      throw error;
    }
  }

  /** Stops accepting requests and removes the run-scoped connection descriptor. */
  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const closeHandler = this.#closeHandler;
    const connection = this.#connection;
    this.#httpServer = null;
    this.#closeHandler = null;
    this.#connection = null;

    const closingServer = httpServer ? closeServer(httpServer) : Promise.resolve();
    if (connection) rmSync(connection.descriptorPath, { force: true });
    await closingServer;
    if (closeHandler) await closeHandler();
    if (connection) this.#logger?.info("MCP server stopped");
  }

  #createProtocolServer(): McpServer {
    const server = new McpServer({ name: "shift", version: "0.1.0" });
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

function hasBearerToken(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length) return false;

  return timingSafeEqual(supplied, expected);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Shift MCP server has no TCP port");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function publishConnection(connection: ShiftMcpConnection): Promise<void> {
  const directory = path.dirname(connection.descriptorPath);
  const temporaryPath = `${connection.descriptorPath}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(connection)}\n`, { mode: 0o600 });
  await rename(temporaryPath, connection.descriptorPath);
}
