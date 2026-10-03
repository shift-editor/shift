import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeShiftCode } from "./code";
import { ShiftMcpServer } from "./server";
import type { ShiftCapabilities } from "@shift/runtime";
import type { ShiftMcpConnection } from "./types";

const capabilities: ShiftCapabilities = {
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
  glyphs: {
    async list() {
      throw new Error("No open Shift window");
    },
    async get() {
      throw new Error("No open Shift window");
    },
  },
  layers: {
    async get() {
      throw new Error("No open Shift window");
    },
  },
};

const execute = (code: string) => executeShiftCode(capabilities, code);
const startedServers: ShiftMcpServer[] = [];
const temporaryDirectories: string[] = [];

async function mcpRequest(
  connection: ShiftMcpConnection,
  method: string,
  params: unknown,
): Promise<unknown> {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.token}`,
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

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.stop()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Shift MCP local connection", () => {
  it("publishes a private run-scoped descriptor and rejects missing secrets", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shift-mcp-"));
    temporaryDirectories.push(directory);
    const descriptorPath = path.join(directory, "connection.json");
    const server = new ShiftMcpServer({ execute, descriptorPath });
    startedServers.push(server);

    const connection = await server.start();
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    const missingSecret = await fetch(connection.url, { method: "POST" });
    const foreignOrigin = await fetch(connection.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        origin: "https://example.com",
      },
    });

    expect(descriptor).toEqual(connection);
    expect((await stat(descriptorPath)).mode & 0o777).toBe(0o600);
    expect(missingSecret.status).toBe(401);
    expect(foreignOrigin.status).toBe(403);

    await server.stop();
    await expect(stat(descriptorPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts an MCP initialization with the run-scoped secret", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shift-mcp-"));
    temporaryDirectories.push(directory);
    const server = new ShiftMcpServer({
      execute,
      descriptorPath: path.join(directory, "connection.json"),
    });
    startedServers.push(server);
    const connection = await server.start();

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

    expect(initialized).toMatchObject({ result: { serverInfo: { name: "shift" } } });
    expect(described).toMatchObject({
      result: { content: [{ text: expect.stringContaining("declare global") }] },
    });
    expect(executed).toMatchObject({ result: { content: [{ text: "[]" }] } });
  });
});
