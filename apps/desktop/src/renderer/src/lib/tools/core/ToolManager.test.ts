import { beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@/lib/editor/Editor";
import { TestEditor } from "@/testing/TestEditor";
import { BaseTool } from "./BaseTool";
import type { Behavior } from "./Behavior";
import type { ToolManifest } from "./ToolManifest";
import type { ToolName } from "./createContext";

type RuntimeToolState = { type: "idle" } | { type: "ready" } | { type: "dragging" };

class RuntimeTool extends BaseTool<RuntimeToolState> {
  readonly id: ToolName;
  readonly behaviors: Behavior<RuntimeToolState>[];

  constructor(editor: Editor, id: ToolName, version: number) {
    super(editor);
    this.id = id;
    this.behaviors = [
      {
        onClick(state, ctx) {
          if (state.type !== "ready") return false;
          ctx.editor.setPan({ x: version, y: 0 });
          return true;
        },
        onDragStart(state, ctx) {
          if (state.type !== "ready") return false;
          ctx.editor.setPan({ x: version, y: 0 });
          ctx.setState({ type: "dragging" });
          return true;
        },
        onDrag(state, ctx) {
          if (state.type !== "dragging") return false;
          ctx.editor.setPan({ x: version, y: 0 });
          return true;
        },
        onDragEnd(state, ctx) {
          if (state.type !== "dragging") return false;
          ctx.setState({ type: "ready" });
          return true;
        },
        onDragCancel(state, ctx) {
          if (state.type !== "dragging") return false;
          ctx.editor.setPan({ x: -version, y: 0 });
          ctx.setState({ type: "ready" });
          return true;
        },
      },
    ];
  }

  initialState(): RuntimeToolState {
    return { type: "idle" };
  }

  override activate(): void {
    this.setState({ type: "ready" });
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
  }
}

const RuntimeIcon: ToolManifest["icon"] = () => null;

function runtimeManifest(
  version: number,
  tooltip = `Runtime ${version}`,
  shortcut?: string,
): ToolManifest {
  const manifest = {
    id: "runtime-test",
    create: (editor: Editor) => new RuntimeTool(editor, "runtime-test", version),
    icon: RuntimeIcon,
    tooltip,
  };

  return shortcut ? { ...manifest, shortcut } : manifest;
}

describe("tool selection and temporary overrides", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
  });

  it("keeps Pen behavior active while Meta is pressed", () => {
    editor.selectTool("pen");
    const penCursor = editor.cursor;

    editor.keyDown("Meta", { metaKey: true });

    expect(editor.cursor).toBe(penCursor);
    expect(editor.currentModifiers.metaKey).toBe(true);
  });

  it("temporarily pans with Hand and then resumes Pen editing", async () => {
    await editor.startSession();
    editor.selectTool("pen");
    const penCursor = editor.cursor;

    editor.requestTemporaryTool("hand");
    editor.pointerDown(0, 0).pointerMove(50, 30).pointerMove(120, 80).pointerUp(120, 80);
    editor.returnFromTemporaryTool();
    await editor.clickGlyphLocal(100, 100);

    expect(editor.pan).toEqual({ x: 120, y: 80 });
    expect(editor.cursor).toBe(penCursor);
    expect(editor.pointCount).toBe(1);
  });

  it("does not replace an active temporary Hand tool", () => {
    editor.selectTool("pen");
    editor.requestTemporaryTool("hand");
    const handCursor = editor.cursor;

    editor.requestTemporaryTool("shape");
    editor.pointerDown(0, 0).pointerMove(50, 0).pointerMove(100, 0).pointerUp(100, 0);

    expect(editor.pan.x).toBe(100);
    expect(editor.cursor).toBe(handCursor);
  });

  it("notifies the temporary-tool lifecycle boundary", () => {
    let activated = false;
    let returned = false;
    editor.selectTool("pen");

    editor.requestTemporaryTool("hand", {
      onActivate: () => (activated = true),
      onReturn: () => (returned = true),
    });
    editor.returnFromTemporaryTool();

    expect(activated).toBe(true);
    expect(returned).toBe(true);
  });

  it("publishes the latest pointer modifiers", () => {
    editor.pointerDown(0, 0, { shiftKey: true, altKey: true, metaKey: true });

    expect(editor.currentModifiers).toEqual({
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });

    editor.pointerMove(10, 10, { shiftKey: false, altKey: false, metaKey: false });

    expect(editor.currentModifiers).toEqual({
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  });
});

describe("runtime tool contributions", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
  });

  it("publishes installed, replaced, and removed metadata", () => {
    const registration = editor.registerTool(runtimeManifest(1, "Runtime One", "r"));

    expect(editor.toolRegistryCell.value.get("runtime-test")?.tooltip).toBe("Runtime One");
    expect(editor.getToolShortcuts()).toContainEqual({ toolId: "runtime-test", shortcut: "r" });

    registration.replace(runtimeManifest(2, "Runtime Two", "u"));

    expect(editor.toolRegistryCell.value.get("runtime-test")?.tooltip).toBe("Runtime Two");
    expect(editor.getToolShortcuts()).toContainEqual({ toolId: "runtime-test", shortcut: "u" });

    registration.dispose();

    expect(editor.toolRegistryCell.value.has("runtime-test")).toBe(false);
  });

  it("rejects duplicate ownership", () => {
    editor.registerTool(runtimeManifest(1));

    expect(() => editor.registerTool(runtimeManifest(2))).toThrow(
      "Tool already registered: runtime-test",
    );
  });

  it("uses an inactive replacement on first activation", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    registration.replace(runtimeManifest(2));

    editor.selectTool("runtime-test").click(0, 0);

    expect(editor.pan.x).toBe(2);
  });

  it("reconstructs an active idle tool without replacing editor-owned state", async () => {
    await editor.startSession();
    const glyphNode = editor.glyphNode;
    const registration = editor.registerTool(runtimeManifest(1));
    editor.selectTool("runtime-test").click(0, 0);

    registration.replace(runtimeManifest(2));
    editor.click(20, 0);

    expect(editor.pan.x).toBe(2);
    expect(editor.glyphNode).toBe(glyphNode);
    expect(editor.toolIf("runtime-test")?.state.type).toBe("ready");
  });

  it("defers active replacement until a drag finishes", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.selectTool("runtime-test");
    editor.pointerDown(0, 0).pointerMove(20, 0);

    registration.replace(runtimeManifest(2));
    editor.pointerMove(30, 0);

    expect(editor.pan.x).toBe(1);

    editor.pointerUp(30, 0).click(0, 0);

    expect(editor.pan.x).toBe(2);
  });

  it("cancels an active drag before removing its tool", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.selectTool("runtime-test");
    editor.pointerDown(0, 0).pointerMove(20, 0);

    registration.dispose();

    expect(editor.pan.x).toBe(-1);
    expect(editor.isDragging).toBe(false);
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("replaces a primary tool while a temporary override is active", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.selectTool("runtime-test");
    editor.requestTemporaryTool("hand");

    registration.replace(runtimeManifest(2));
    editor.returnFromTemporaryTool();
    editor.click(0, 0);

    expect(editor.pan.x).toBe(2);
  });

  it("does not let a disposed handle remove a newer owner", () => {
    const previous = editor.registerTool(runtimeManifest(1));
    previous.dispose();
    editor.registerTool(runtimeManifest(2));

    previous.dispose();

    expect(editor.toolRegistryCell.value.has("runtime-test")).toBe(true);
  });
});
