import { describe, expectTypeOf, it } from "vitest";
import type { Editor } from "../../editor/Editor";
import type { Signal } from "../../signals/signal";
import type { BaseTool, ToolState } from "./BaseTool";
import type { KerningTool } from "../kerning/Kerning";
import type { PenState } from "../pen/types";

describe("toolIf", () => {
  it("types a built-in tool as its class", () => {
    const kerning = (editor: Editor) => editor.toolIf("kerning");
    const kerningCell = (editor: Editor) => editor.toolCellIf("kerning");

    expectTypeOf(kerning).returns.toEqualTypeOf<KerningTool | null>();
    expectTypeOf(kerningCell).returns.toEqualTypeOf<Signal<KerningTool | null>>();
  });

  it("types a built-in tool's state as that tool's state", () => {
    const penState = (editor: Editor) => editor.toolIf("pen")?.state;

    expectTypeOf(penState).returns.toEqualTypeOf<PenState | undefined>();
  });

  it("types a runtime tool at the base contract", () => {
    const runtime = (editor: Editor) => editor.toolIf("runtime-tool");

    expectTypeOf(runtime).returns.toEqualTypeOf<BaseTool<ToolState> | null>();
  });
});
