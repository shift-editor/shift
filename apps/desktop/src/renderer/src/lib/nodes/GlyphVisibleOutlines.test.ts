import { beforeEach, describe, expect, it } from "vitest";
import { asNamedInstanceId, type NodeId, type SourceId } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { TestEditor } from "@/testing/TestEditor";

describe("glyph nodes draw only resolvable outlines outside hand panning", () => {
  let editor: TestEditor;
  let nodeId: NodeId;
  let boldSourceId: SourceId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const axisId = editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await editor.settle();
    boldSourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));
    await editor.settle();
    const node = editor.glyphNode;
    if (!node) throw new Error("Expected glyph node");
    nodeId = node.id;
  });

  it("skips targets whose source or instance no longer exists", () => {
    const source = { kind: "source", sourceId: boldSourceId } as const;
    const missing = { kind: "instance", instanceId: asNamedInstanceId("missing") } as const;

    editor.nodeDefinition("glyph").outlines.set(nodeId, [missing, source]);

    expect(editor.nodeDefinition("glyph").visibleOutlines(nodeId)).toEqual([source]);
  });

  it("hides every outline while the hand tool is active", () => {
    const source = { kind: "source", sourceId: boldSourceId } as const;
    editor.nodeDefinition("glyph").outlines.set(nodeId, [source]);

    editor.selectTool("hand");
    expect(editor.nodeDefinition("glyph").visibleOutlines(nodeId)).toEqual([]);

    editor.selectTool("select");
    expect(editor.nodeDefinition("glyph").visibleOutlines(nodeId)).toEqual([source]);
  });
});
