import { request as httpRequest } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { executeShiftCode } from "@shift/sandbox";
import { ShiftMcpServer } from "./server";
import type { ShiftCapabilities } from "@shift/runtime";
import type { ShiftMcpConnection } from "./types";

const capabilities: ShiftCapabilities = {
  async capture({ windowId, target, scale = 1 }) {
    return {
      fontRevision: "revision-a",
      value: {
        captureId: "capture-a",
        windowId,
        target,
        mimeType: "image/png",
        data: "cG5n",
        width: 800,
        height: 600,
        scale,
        capturedAt: "2026-10-08T10:00:00.000Z",
      },
    };
  },
  sessions: {
    async list() {
      return [];
    },
  },
  editor: {
    async inspect() {
      throw new Error("No open Shift window");
    },
  },
  font: {
    async get() {
      throw new Error("No open Shift window");
    },
  },
  locations: {
    async resolve() {
      throw new Error("No open Shift window");
    },
  },
  glyphs: {
    async list() {
      throw new Error("No open Shift window");
    },
    async get() {
      throw new Error("No open Shift window");
    },
    async resolve() {
      throw new Error("No open Shift window");
    },
  },
  layers: {
    async get() {
      throw new Error("No open Shift window");
    },
    async resolve() {
      throw new Error("No open Shift window");
    },
    async render() {
      throw new Error("No open Shift window");
    },
  },
  kerning: {
    async groups() {
      throw new Error("No open Shift window");
    },
    async pairs() {
      throw new Error("No open Shift window");
    },
    async resolve() {
      throw new Error("No open Shift window");
    },
  },
};

const execute = (code: string) => executeShiftCode(capabilities, code);
const capture = capabilities.capture;
const startedServers: ShiftMcpServer[] = [];

function startServer(options: Partial<ConstructorParameters<typeof ShiftMcpServer>[0]> = {}) {
  const server = new ShiftMcpServer({
    execute,
    capture,
    port: 0,
    serverInfo: { name: "shift-dev", version: "0.2.0" },
    ...options,
  });
  startedServers.push(server);
  return server;
}

async function mcpRequest(
  connection: ShiftMcpConnection,
  method: string,
  params: unknown,
): Promise<unknown> {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  return body.startsWith("event:")
    ? JSON.parse(body.split("\ndata: ")[1]!.trim())
    : JSON.parse(body);
}

/** Sends a request with a chosen `Host` header, which `fetch` does not allow overriding. */
function statusWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
}

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.stop()));
});

describe("Shift MCP local connection", () => {
  it("rejects browser origins and foreign hosts without needing a credential", async () => {
    const connection = await startServer().start();

    const foreignOrigin = await fetch(connection.url, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    const foreignHost = await statusWithHost(connection.url, "evil.example");
    const localOrigin = await fetch(connection.url, {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });

    expect(new URL(connection.url).hostname).toBe("127.0.0.1");
    expect(foreignOrigin.status).toBe(403);
    expect(foreignHost).toBe(403);
    expect(localOrigin.status).not.toBe(403);
  });

  it("answers MCP requests from local agents without a credential", async () => {
    const connection = await startServer().start();

    const initialized = await mcpRequest(connection, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "shift-test", version: "1.0.0" },
    });
    const described = await mcpRequest(connection, "tools/call", {
      name: "shift.describe",
      arguments: {},
    });
    const executed = await mcpRequest(connection, "tools/call", {
      name: "shift.execute",
      arguments: { code: "async () => await shift.sessions.list()" },
    });
    const captured = await mcpRequest(connection, "tools/call", {
      name: "shift.capture",
      arguments: { windowId: 7, target: "editor" },
    });

    const guide = await mcpRequest(connection, "tools/call", {
      name: "shift.guide",
      arguments: {},
    });
    const cliGuide = await mcpRequest(connection, "tools/call", {
      name: "shift.guide",
      arguments: { topic: "cli" },
    });

    expect(initialized).toMatchObject({
      result: {
        serverInfo: { name: "shift-dev", version: "0.2.0" },
        instructions: expect.stringContaining("shift.guide"),
      },
    });
    expect(guide).toMatchObject({
      result: { content: [{ text: expect.stringContaining("name: shift") }] },
    });
    expect(cliGuide).toMatchObject({
      result: { content: [{ text: expect.stringContaining("# shift-cli") }] },
    });
    expect(described).toMatchObject({
      result: { content: [{ text: expect.stringContaining("declare global") }] },
    });
    expect(executed).toMatchObject({ result: { content: [{ text: "[]" }] } });
    expect(captured).toMatchObject({
      result: {
        content: [
          { type: "image", mimeType: "image/png", data: "cG5n" },
          { type: "text", text: expect.stringContaining('"fontRevision": "revision-a"') },
        ],
      },
    });
  });

  it("names a non-release build's command-line tool in the guide", async () => {
    const release = await startServer().start();
    const nightly = await startServer({ commandLineTool: "shift-cli-nightly" }).start();
    const guideText = async (connection: ShiftMcpConnection) => {
      const response = (await mcpRequest(connection, "tools/call", {
        name: "shift.guide",
        arguments: { topic: "cli" },
      })) as { result: { content: [{ text: string }] } };
      return response.result.content[0].text;
    };

    expect(await guideText(release)).toMatch(/^# shift-cli\n/);
    expect(await guideText(nightly)).toMatch(
      /^This build installs its command-line tool as `shift-cli-nightly`/,
    );
  });

  it("connects with a native MCP client", async () => {
    const connection = await startServer().start();
    const client = new Client({ name: "shift-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(connection.url));

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "shift.execute",
        arguments: { code: "async () => await shift.sessions.list()" },
      });
      expect(result.content).toMatchObject([{ type: "text", text: "[]" }]);
    } finally {
      await client.close();
    }
  });

  it("reports which agents recently connected and forgets them when stopped", async () => {
    let now = 1_000;
    const reported: unknown[] = [];
    const server = startServer({
      now: () => now,
      onActivity: (activity) => reported.push(activity),
    });
    const connection = await server.start();

    await mcpRequest(connection, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.0.0" },
    });
    now = 2_000;
    await mcpRequest(connection, "tools/call", { name: "shift.describe", arguments: {} });

    expect(server.activity).toEqual({
      lastRequestAt: 2_000,
      clients: [{ name: "claude-code", lastSeenAt: 1_000 }],
    });
    expect(reported.at(-1)).toEqual(server.activity);

    now += 11 * 60 * 1000;
    expect(server.activity.clients).toEqual([]);

    await server.stop();
    expect(server.activity).toEqual({ lastRequestAt: null, clients: [] });
  });

  it("can stop and start again on the same port", async () => {
    const server = startServer();
    const first = await server.start();
    await server.stop();
    await expect(fetch(first.url, { method: "POST" })).rejects.toThrow();

    const second = await startServer({ port: Number(new URL(first.url).port) }).start();
    expect(second.url).toBe(first.url);
  });

  it("does not fall back to another port when its port is occupied", async () => {
    const connection = await startServer().start();
    const second = startServer({ port: Number(new URL(connection.url).port) });

    await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
