import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShiftMcpServer } from "@shift/mcp";
import type { AgentConnectionsState } from "../../shared/agent/connections";
import { AgentConnections } from "./AgentConnections";

const log = { debug() {}, info() {}, warn() {}, error() {} };
const opened: AgentConnections[] = [];
const blockers: Server[] = [];
let directory: string;

function connections(port = 0): AgentConnections {
  const created = new AgentConnections({
    settingsPath: path.join(directory, "agent-connections.json"),
    serverName: "shift-test",
    port,
    createServer: (onActivity) =>
      new ShiftMcpServer({
        execute: async () => null,
        capture: async () => {
          throw new Error("no windows");
        },
        port,
        onActivity,
      }),
    log,
  });
  opened.push(created);
  return created;
}

async function occupiedPort(): Promise<number> {
  const blocker = createServer();
  blockers.push(blocker);
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const address = blocker.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port");
  return address.port;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((created) => created.shutdown()));
  await Promise.all(
    blockers.splice(0).map((blocker) => new Promise((resolve) => blocker.close(resolve))),
  );
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("AgentConnections", () => {
  it("is off by default and does not listen", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "shift-agents-"));
    const agents = connections();

    await agents.resume();

    expect(agents.state).toMatchObject({ allowed: false, status: "off", serverName: "shift-test" });
  });

  it("starts the server when allowed, remembers the choice, and stops when disallowed", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "shift-agents-"));
    const agents = connections();
    const published: AgentConnectionsState[] = [];
    agents.onChanged((state) => published.push(state));

    await agents.setAllowed(true);
    const { url } = agents.state;
    const initialized = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-code", version: "1.0.0" },
        },
      }),
    });

    expect(agents.state.status).toBe("listening");
    expect(initialized.status).toBe(200);
    expect(agents.state.activity.clients.map(({ name }) => name)).toEqual(["claude-code"]);
    expect(published.at(-1)?.activity.clients).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(path.join(directory, "agent-connections.json"), "utf8")),
    ).toEqual({ allowed: true });

    await agents.shutdown();
    const relaunched = connections();
    await relaunched.resume();
    expect(relaunched.state).toMatchObject({ allowed: true, status: "listening" });

    await relaunched.setAllowed(false);
    expect(relaunched.state).toMatchObject({ allowed: false, status: "off" });
    await expect(fetch(relaunched.state.url, { method: "POST" })).rejects.toThrow();
  });

  it("stays allowed but reports a failure when its port is taken", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "shift-agents-"));
    const port = await occupiedPort();
    const agents = connections(port);

    await agents.setAllowed(true);

    expect(agents.state).toMatchObject({
      allowed: true,
      status: "failed",
      url: `http://127.0.0.1:${port}/mcp`,
      error: expect.stringContaining(`Port ${port} is already in use`),
    });
  });
});
