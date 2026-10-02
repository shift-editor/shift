#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const APP_NAMES = ["Shift Dev", "Shift Nightly Dev", "Shift", "Shift Nightly"];
let requestId = 0;

async function main() {
  const command = process.argv[2];
  const { descriptorPath, operands } = parseArguments(process.argv.slice(3));

  switch (command) {
    case "connections": {
      const connections = await discoverConnections();
      console.log(
        JSON.stringify(
          connections.map(({ descriptorPath: discoveredPath, connection }) => ({
            descriptorPath: discoveredPath,
            url: connection.url,
          })),
          null,
          2,
        ),
      );
      return;
    }
    case "describe": {
      const connection = await selectConnection(descriptorPath);
      await initialize(connection);
      const result = await callTool(connection, "shift.describe", {});
      printToolText(result);
      return;
    }
    case "execute": {
      const connection = await selectConnection(descriptorPath);
      const code = operands.length > 0 ? operands.join(" ") : await readStdin();
      if (!code.trim()) throw new Error("execute requires code as an argument or on stdin");

      await initialize(connection);
      const result = await callTool(connection, "shift.execute", { code });
      printToolText(result);
      return;
    }
    default:
      throw new Error(
        "usage: client.mjs connections | describe [--descriptor path] | execute [--descriptor path] [code]",
      );
  }
}

function parseArguments(args) {
  let descriptorPath = process.env.SHIFT_MCP_DESCRIPTOR;
  const operands = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--descriptor") {
      operands.push(argument);
      continue;
    }

    descriptorPath = args[index + 1];
    if (!descriptorPath) throw new Error("--descriptor requires a path");
    index += 1;
  }

  return { descriptorPath, operands };
}

async function selectConnection(requestedPath) {
  if (requestedPath) return readConnection(path.resolve(requestedPath));

  const connections = await discoverConnections();
  if (connections.length === 0) throw new Error("no running Shift MCP connection found");
  if (connections.length > 1) {
    const paths = connections.map(({ descriptorPath }) => descriptorPath).join("\n");
    throw new Error(`multiple Shift MCP connections found; pass --descriptor:\n${paths}`);
  }

  return connections[0].connection;
}

async function discoverConnections() {
  const root = applicationDataRoot();
  const configuredPath = process.env.SHIFT_MCP_DESCRIPTOR;
  const discoveredPaths = APP_NAMES.map((name) => path.join(root, name, "mcp.json"));
  const candidates = [
    ...(configuredPath ? [path.resolve(configuredPath)] : []),
    ...discoveredPaths,
  ].filter((candidate, index, paths) => paths.indexOf(candidate) === index);
  const connections = [];

  for (const descriptorPath of candidates) {
    try {
      const [connection, descriptorStat] = await Promise.all([
        readConnection(descriptorPath),
        stat(descriptorPath),
      ]);
      connections.push({ descriptorPath, connection, modified: descriptorStat.mtimeMs });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return connections.sort((left, right) => right.modified - left.modified);
}

function applicationDataRoot() {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support");
    case "win32": {
      const appData = process.env.APPDATA;
      if (!appData) throw new Error("APPDATA is not set");
      return appData;
    }
    default:
      return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  }
}

async function readConnection(descriptorPath) {
  const connection = JSON.parse(await readFile(descriptorPath, "utf8"));
  if (typeof connection?.url !== "string" || typeof connection?.token !== "string") {
    throw new Error(`invalid Shift MCP descriptor: ${descriptorPath}`);
  }

  return connection;
}

async function initialize(connection) {
  await request(connection, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "shift-agent-skill", version: "0.1.0" },
  });
}

async function callTool(connection, name, args) {
  const response = await request(connection, "tools/call", { name, arguments: args });
  if (response.isError) throw new Error(toolText(response));
  return response;
}

async function request(connection, method, params) {
  requestId += 1;
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Shift MCP request failed (${response.status}): ${text}`);

  const message = parseMessage(text);
  if (message.error) throw new Error(message.error.message ?? JSON.stringify(message.error));
  return message.result;
}

function parseMessage(body) {
  if (!body.startsWith("event:")) return JSON.parse(body);

  const dataLines = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  if (dataLines.length === 0) throw new Error("Shift MCP returned an empty event stream");
  return JSON.parse(dataLines[dataLines.length - 1]);
}

function toolText(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function printToolText(result) {
  console.log(toolText(result));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
