import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ShiftMcpServer } from "@shift/mcp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));

describe("Shift MCP client", () => {
  it("calls the live server with a descriptor using the MCP transport", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shift-mcp-client-"));
    const descriptorPath = path.join(directory, "mcp.json");
    const server = new ShiftMcpServer({
      descriptorPath,
      async execute(code) {
        return { received: code };
      },
    });

    try {
      await server.start();
      const code = "async () => 42";
      const { stdout } = await execFileAsync(process.execPath, [
        cli,
        "execute",
        "--descriptor",
        descriptorPath,
        code,
      ]);
      expect(JSON.parse(stdout)).toEqual({ received: code });
    } finally {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
