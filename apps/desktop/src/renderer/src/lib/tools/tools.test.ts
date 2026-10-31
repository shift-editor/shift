import { describe, expect, it } from "vitest";
import { startTestEditor } from "@/testing/TestEditor";

describe("registerBuiltInTools", () => {
  it("puts Kerning in the Spacing slot and binds it to K", async () => {
    const editor = await startTestEditor();

    expect(editor.toolShortcuts()).toContainEqual({ key: "k", tool: "kerning" });
    expect(editor.toolbar().map(({ tool }) => tool)).not.toContain("kerning");
    expect(editor.toolbar()).toContainEqual({ tool: "spacing", menu: ["spacing", "kerning"] });
    await editor.close();
  });
});
