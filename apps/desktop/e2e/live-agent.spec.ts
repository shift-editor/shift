import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { workspaceTest as test, expect } from "./fixtures/electronApp";

const execFileAsync = promisify(execFile);
const MCP_CLIENT = path.resolve(__dirname, "../../../.agents/skills/shift/scripts/client.mjs");

async function runShiftCode(testRoot: string, code: string): Promise<unknown> {
  const descriptor = path.join(testRoot, "user-data", "mcp.json");
  const { stdout } = await execFileAsync(process.execPath, [
    MCP_CLIENT,
    "execute",
    "--descriptor",
    descriptor,
    code,
  ]);
  return JSON.parse(stdout);
}

test("inspects the explicitly targeted live editor", async ({ editor, testRoot }) => {
  await editor.openGlyphByName("A");
  const point = await editor.selectVisiblePoint();

  const observation = await runShiftCode(
    testRoot,
    `async () => {
      const sessions = await shift.sessions.list();
      const target = sessions.find((session) => session.editorConnected);
      if (!target) throw new Error("Expected connected editor");

      let missingWindowError = null;
      try {
        await shift.editor.inspect({ windowId: 2147483647 });
      } catch (error) {
        missingWindowError = error.message;
      }

      return {
        sessions,
        editor: await shift.editor.inspect({ windowId: target.windowId }),
        missingWindowError,
      };
    }`,
  );

  expect(observation).toMatchObject({
    sessions: [{ mode: "workspace", editorConnected: true }],
    editor: {
      glyph: { name: "A" },
      selectionIds: [point.id],
      tool: { id: "select" },
      applyStatus: "idle",
    },
    missingWindowError: "Shift window 2147483647 is not open",
  });
});
