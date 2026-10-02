import { asGlyphId, asNodeId, asPointId, asSourceId } from "@shift/types";
import type { ShiftCapabilities } from "@shift/runtime";
import { describe, expect, it } from "vitest";
import { executeShiftCode } from "./code";

const capabilities: ShiftCapabilities = {
  sessions: {
    async list() {
      return [
        {
          windowId: 7,
          sessionId: "session-a",
          mode: "workspace",
          focused: true,
          editorConnected: true,
        },
      ];
    },
  },
  editor: {
    async inspect({ windowId }) {
      return {
        windowId,
        sessionId: "session-a",
        mode: "workspace",
        route: "/editor/glyph-a",
        glyph: {
          glyphId: asGlyphId("glyph-a"),
          name: "A",
          nodeId: asNodeId("node-a"),
          sourceId: asSourceId("source-a"),
        },
        activeSourceId: asSourceId("source-a"),
        editingSourceIds: [asSourceId("source-a")],
        externalLocation: [],
        selectionIds: [asPointId("point-a")],
        tool: { id: "select", state: "idle" },
        dragging: false,
        editing: true,
        applyStatus: "idle",
      };
    },
  },
};

describe("Shift code mode exposes bounded live capabilities", () => {
  it("composes session discovery and editor inspection", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const [session] = await shift.sessions.list(); return shift.editor.inspect({ windowId: session.windowId }); }",
    );

    expect(result).toMatchObject({ windowId: 7, glyph: { name: "A" }, selectionIds: ["point-a"] });
  });

  it("cannot access Node process globals", async () => {
    await expect(executeShiftCode(capabilities, "async () => typeof process")).resolves.toBe(
      "undefined",
    );
  });

  it("requires a JSON-compatible result", async () => {
    await expect(executeShiftCode(capabilities, "async () => undefined")).rejects.toThrow(
      "shift.execute must return a JSON value",
    );
  });

  it("stops code that never settles", async () => {
    await expect(
      executeShiftCode(capabilities, "async () => await new Promise(() => {})"),
    ).rejects.toThrow("shift.execute timed out");
  });
});
