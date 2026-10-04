import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { FastifyInstance } from "fastify";
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
  port: number;
  logger?: ShiftMcpLogger;
}

/** Serves code-mode access to one running Shift application over loopback HTTP. */
export class ShiftMcpServer {
  readonly #execute: (code: string) => Promise<unknown>;
  readonly #descriptorPath: string;
  readonly #port: number;
  readonly #logger: ShiftMcpLogger | undefined;
  #httpServer: FastifyInstance | null = null;
  #closeHandler: (() => Promise<void>) | null = null;
  #connection: ShiftMcpConnection | null = null;

  /**
   * Creates an unstarted server bound to a host-owned isolated executor.
   *
   * @param options - execution callback, private descriptor path, port, and optional diagnostics sink.
   */
  constructor(options: ShiftMcpServerOptions) {
    this.#execute = options.execute;
    this.#descriptorPath = options.descriptorPath;
    this.#port = options.port;
    this.#logger = options.logger;
  }

  /** Starts the loopback server and publishes persistent same-user connection details. */
  async start(): Promise<ShiftMcpConnection> {
    if (this.#connection) return this.#connection;

    const token = await readOrCreateToken(this.#descriptorPath);
    const handler = createMcpHandler(() => this.#createProtocolServer());
    const nodeHandler = toNodeHandler(handler, {
      maxRequestBodySize: 128 * 1024,
      onerror: (error) => this.#logger?.error("MCP request failed", error),
    });
    const httpServer = createMcpFastifyApp();
    httpServer.all(MCP_PATH, { bodyLimit: 128 * 1024 }, async (request, reply) => {
      if (!hasBearerToken(request.headers.authorization, token)) {
        return reply.code(401).send({ error: "invalid Shift MCP connection secret" });
      }

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
      await httpServer.close();
      await handler.close();
      throw error;
    }
  }

  /** Stops accepting requests while retaining the user's connection credential. */
  async stop(): Promise<void> {
    const httpServer = this.#httpServer;
    const closeHandler = this.#closeHandler;
    const connection = this.#connection;
    this.#httpServer = null;
    this.#closeHandler = null;
    this.#connection = null;

    if (httpServer) await httpServer.close();
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

async function readOrCreateToken(descriptorPath: string): Promise<string> {
  try {
    const file = await lstat(descriptorPath);
    if (!file.isFile() || (process.platform !== "win32" && (file.mode & 0o077) !== 0)) {
      throw new Error(`insecure Shift MCP descriptor: ${descriptorPath}`);
    }

    const connection = JSON.parse(await readFile(descriptorPath, "utf8")) as ShiftMcpConnection;
    if (typeof connection?.token !== "string" || !/^[\w-]{43}$/.test(connection.token)) {
      throw new Error(`invalid Shift MCP descriptor: ${descriptorPath}`);
    }
    return connection.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return randomBytes(32).toString("base64url");
  }
}

async function publishConnection(connection: ShiftMcpConnection): Promise<void> {
  const directory = path.dirname(connection.descriptorPath);
  const temporaryPath = `${connection.descriptorPath}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(connection)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, connection.descriptorPath);
}
