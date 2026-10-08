import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ShiftMcpConnection } from "@shift/mcp";
import { workspaceTest as test, expect, UFO_FONT_PATH } from "./fixtures/electronApp";

async function runShiftCode(testRoot: string, code: string): Promise<unknown> {
  const descriptor = path.join(testRoot, "user-data", "mcp.json");
  const connection = JSON.parse(await readFile(descriptor, "utf8")) as ShiftMcpConnection;
  const client = new Client({ name: "shift-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    authProvider: { token: async () => connection.token },
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "shift.execute", arguments: { code } });
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}

test.describe("authored font reads from Home", () => {
  test.use({ startupFontPath: UFO_FONT_PATH });

  test("paginates glyphs and reads named source anchors", async ({
    page: workspacePage,
    testRoot,
  }) => {
    await expect(workspacePage).toHaveURL(/#\/home/);
    const result = await runShiftCode(
      testRoot,
      `async () => {
        const session = (await shift.sessions.list()).find(({ editorConnected }) => editorConnected);
        if (!session) throw new Error("Expected connected font");
        const windowId = session.windowId;
        const font = await shift.font.get({ windowId });
        const first = await shift.glyphs.list({ windowId, limit: 1 });
        const second = await shift.glyphs.list({ windowId, limit: 1, cursor: first.nextCursor });
        const glyph = await shift.glyphs.get({ windowId, glyphId: first.items[0].id });
        const directory = await shift.glyphs.list({ windowId, limit: 100 });
        const e = directory.items.find(({ name }) => name === "E");
        if (!e) throw new Error("Fixture glyph E is missing");
        const eByName = await shift.glyphs.get({ windowId, name: "E" });
        const sourceId = font.sources[0].id;
        const layer = await shift.layers.get({ windowId, glyphId: e.id, sourceId });
        const rendered = await shift.layers.render({
          windowId,
          glyphId: e.id,
          sourceId,
          overlays: {
            points: true,
            controlLines: true,
            anchors: true,
            components: true,
            fontMetrics: true,
          },
          appearance: { outlineFill: "#123456" },
        });
        const sourcePage = await shift.glyphs.list({ windowId, limit: 1, sourceId });
        const a = directory.items.find(({ name }) => name === "A");
        const supportId = a?.sourceIds.find((id) => id !== sourceId);
        if (!a || !supportId) throw new Error("Missing support-layer fixture");
        const sparse = directory.items.find(({ sourceIds }) => !sourceIds.includes(supportId));
        if (!sparse) throw new Error("Missing sparse-layer fixture");
        const support = await shift.layers.get({ windowId, glyphId: a.id, sourceId: supportId });
        const absent = await shift.layers.get({ windowId, glyphId: sparse.id, sourceId: supportId });
        const supportPage = await shift.glyphs.list({ windowId, limit: 100, sourceId: supportId });
        return {
          supportLayerId: support?.layerId,
          absent,
          sparseStructure: supportPage.items.find(({ id }) => id === sparse.id)?.structure,
          supportStructure: supportPage.items.find(({ id }) => id === a.id)?.structure,
          familyName: font.metadata.familyName,
          unitsPerEm: font.metrics.unitsPerEm,
          glyphCount: font.glyphCount,
          mode: font.mode,
          first: first.items[0],
          nextCursor: first.nextCursor,
          second: second.items[0],
          glyph,
          anchors: layer?.anchors.map(({ name }) => name),
          rendered: rendered && {
            layerId: rendered.layerId,
            viewBox: rendered.viewBox,
            hasOutline: rendered.svg.includes('data-shift-role="outline"'),
            hasPoints: rendered.svg.includes('data-shift-role="points"'),
            hasAnchors: rendered.svg.includes('data-shift-role="anchors"'),
            hasFontMetrics: rendered.svg.includes('data-shift-role="font-metrics"'),
            hasAdvanceWidth: rendered.svg.includes('data-shift-role="advance-width"'),
            hasAppearance: rendered.svg.includes('fill="#123456"'),
            guides: rendered.guides,
          },
          eId: e.id,
          eByNameId: eByName.id,
          structure: sourcePage.items[0].structure,
        };
      }`,
    );

    expect(result).toMatchObject({
      familyName: "MutatorMathTest",
      unitsPerEm: 1000,
      glyphCount: 48,
      mode: "workspace",
      anchors: ["top"],
      absent: null,
      sparseStructure: null,
      supportLayerId: expect.any(String),
      rendered: {
        layerId: expect.any(String),
        viewBox: [expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
        hasOutline: true,
        hasPoints: true,
        hasAnchors: true,
        hasFontMetrics: true,
        hasAdvanceWidth: false,
        hasAppearance: true,
        guides: {
          fontMetrics: {
            ascender: expect.any(Number),
            baseline: expect.any(Number),
            descender: expect.any(Number),
          },
          advanceWidth: { origin: 0, advance: expect.any(Number) },
        },
      },
    });
    const page = result as {
      first: { id: string };
      nextCursor: string;
      second: { id: string };
      glyph: { id: string };
      structure: unknown;
      supportStructure: unknown;
      eId: string;
      eByNameId: string;
    };
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.second.id).not.toBe(page.first.id);
    expect(page.glyph.id).toBe(page.first.id);
    expect(page.eByNameId).toBe(page.eId);
    expect(page.structure).not.toBeNull();
    expect(page.supportStructure).not.toBeNull();
  });
});

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

      const capture = await shift.capture({
        windowId: target.windowId,
        target: "editor",
        scale: 0.25,
      });
      const { data, ...captureMetadata } = capture;

      return {
        sessions,
        editor: await shift.editor.inspect({ windowId: target.windowId }),
        capture: { ...captureMetadata, dataLength: data.length },
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
    capture: {
      captureId: expect.any(String),
      target: "editor",
      mimeType: "image/png",
      width: expect.any(Number),
      height: expect.any(Number),
      scale: 0.25,
      capturedAt: expect.any(String),
      dataLength: expect.any(Number),
    },
    missingWindowError: "Shift window 2147483647 is not open",
  });
});
