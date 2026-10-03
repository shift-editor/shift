#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const APP_NAMES = ["Shift Dev", "Shift Nightly Dev", "Shift", "Shift Nightly"];

async function main() {
  const command = process.argv[2];
  const { descriptorPath, operands } = parseArguments(process.argv.slice(3));

  if (command === "connections") {
    const connections = await discoverConnections();
    const output = JSON.stringify(
      connections.map(({ descriptorPath: discoveredPath, connection }) => ({
        descriptorPath: discoveredPath,
        url: connection.url,
      })),
      null,
      2,
    );
    process.stdout.write(`${output}\n`);
    return;
  }

  if (command !== "describe" && command !== "execute") {
    throw new Error(
      "usage: shift-mcp connections | describe [--descriptor path] | execute [--descriptor path] [code]",
    );
  }

  const connection = await selectConnection(descriptorPath);
  const code = command === "execute" ? operands.join(" ") || (await readStdin()) : null;
  if (command === "execute" && !code.trim()) {
    throw new Error("execute requires code as an argument or on stdin");
  }

  const client = new Client({ name: "shift-mcp", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    authProvider: { token: async () => connection.token },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: command === "describe" ? "shift.describe" : "shift.execute",
      arguments: command === "execute" ? { code } : {},
    });
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (result.isError) throw new Error(text);
    process.stdout.write(`${text}\n`);
  } finally {
    await client.close();
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
