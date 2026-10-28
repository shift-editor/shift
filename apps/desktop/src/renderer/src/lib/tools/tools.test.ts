import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("registerBuiltInTools", () => {
  it("puts Kerning in the Spacing slot and binds it to K", async () => {
    const editor = await new TestEditor().startSession();

    expect(editor.getToolShortcuts()).toContainEqual(
      expect.objectContaining({ toolId: "kerning", shortcut: "k" }),
    );
    expect(editor.toolRegistry.get("kerning")?.hidden).toBe(true);
    expect(editor.toolRegistry.get("spacing")?.menuItems?.map((item) => item.toolId)).toEqual([
      "spacing",
      "kerning",
    ]);
    await editor.close();
  });
});
