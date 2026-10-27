import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "../../editor/Editor";
import { screenPoint } from "../../editor/spaces";
import { asPointId } from "@shift/types";
import type { MemoryFontSession } from "../../../types/fontSession";
import { startEmptyMemorySession } from "../../../testing/emptyMemorySession";
import { BaseTool } from "./BaseTool";
import type { Behavior } from "./Behavior";
import type { ToolManifest } from "./ToolManifest";
import type { ToolName } from "./createContext";

type RuntimeToolState = { type: "idle" } | { type: "ready" } | { type: "dragging" };
type RuntimeDragEnd = "complete" | "leave-open" | "throw";

class RuntimeTool extends BaseTool<RuntimeToolState> {
  readonly id: ToolName;
  readonly behaviors: Behavior<RuntimeToolState>[];

  constructor(editor: Editor, id: ToolName, version: number, dragEnd: RuntimeDragEnd = "complete") {
    super(editor);
    this.id = id;
    let done: (() => void) | null = null;
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
          done = ctx.onCancel(() => ctx.editor.setPan({ x: -version, y: 0 }));
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

          switch (dragEnd) {
            case "complete":
              if (done) done();
              break;
            case "leave-open":
              break;
            case "throw":
              throw new Error("runtime drag failed");
          }

          done = null;
          ctx.setState({ type: "ready" });
          return true;
        },
        onDragCancel(state, ctx) {
          if (state.type !== "dragging") return false;
          done = null;
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

const NO_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

/** Drives the editor's pointer input in screen pixels, as the canvas does. */
class Pointer {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  down(x: number, y: number, modifiers = NO_MODIFIERS): this {
    this.#editor.toolManager.handlePointerDown(screenPoint(x, y), modifiers);
    return this;
  }

  move(x: number, y: number, modifiers = NO_MODIFIERS): this {
    this.#editor.toolManager.handlePointerMove(screenPoint(x, y), modifiers, { force: true });
    this.#editor.toolManager.flushPointerMoves();
    return this;
  }

  up(x: number, y: number, modifiers = NO_MODIFIERS): this {
    this.#editor.toolManager.handlePointerUp(screenPoint(x, y), modifiers);
    return this;
  }

  click(x: number, y: number): this {
    return this.down(x, y).up(x, y);
  }
}

let session: MemoryFontSession;
let editor: Editor;
let pointer: Pointer;

beforeEach(() => {
  session = startEmptyMemorySession();
  editor = session.editor;
  pointer = new Pointer(editor);
});
afterEach(() => session.dispose());

describe("temporary tool overrides", () => {
  it("does not replace an active temporary Hand tool", () => {
    editor.setActiveTool("select");
    editor.requestTemporaryTool("hand");
    const handCursor = editor.cursor;

    editor.requestTemporaryTool("select");
    pointer.down(0, 0).move(50, 0).move(100, 0).up(100, 0);

    expect(editor.pan.x).toBe(100);
    expect(editor.cursor).toBe(handCursor);
  });

  it("notifies the temporary-tool lifecycle boundary", () => {
    let activated = false;
    let returned = false;
    editor.setActiveTool("select");

    editor.requestTemporaryTool("hand", {
      onActivate: () => (activated = true),
      onReturn: () => (returned = true),
    });
    editor.returnFromTemporaryTool();

    expect(activated).toBe(true);
    expect(returned).toBe(true);
  });

  it("publishes the latest pointer modifiers", () => {
    pointer.down(0, 0, { shiftKey: true, altKey: true, metaKey: true });

    expect(editor.currentModifiers).toEqual({
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });

    pointer.move(10, 10, NO_MODIFIERS);

    expect(editor.currentModifiers).toEqual(NO_MODIFIERS);
  });
});

describe("runtime tool contributions", () => {
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

  it("publishes availability metadata without user shortcuts", () => {
    const registration = editor.registerTool({
      ...runtimeManifest(1, "Runtime", "r"),
      disabled: true,
    });

    expect(editor.toolRegistryCell.value.get("runtime-test")?.disabled).toBe(true);
    expect(editor.getToolShortcuts()).not.toContainEqual({ toolId: "runtime-test", shortcut: "r" });

    registration.replace({ ...runtimeManifest(1, "Runtime", "r"), hidden: true });

    expect(editor.toolRegistryCell.value.get("runtime-test")?.hidden).toBe(true);
    expect(editor.getToolShortcuts()).not.toContainEqual({ toolId: "runtime-test", shortcut: "r" });
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

    editor.setActiveTool("runtime-test");
    pointer.click(0, 0);

    expect(editor.pan.x).toBe(2);
  });

  it("reconstructs an active idle tool without replacing editor-owned state", () => {
    const point = asPointId("point_kept");
    editor.selection.select([point]);
    const registration = editor.registerTool(runtimeManifest(1));
    editor.setActiveTool("runtime-test");
    pointer.click(0, 0);

    registration.replace(runtimeManifest(2));
    pointer.click(20, 0);

    expect(editor.pan.x).toBe(2);
    expect(editor.selection.ids).toEqual([point]);
    expect(editor.toolIf("runtime-test")?.state.type).toBe("ready");
  });

  it("keeps a completed drag result", () => {
    editor.registerTool(runtimeManifest(1));
    editor.setActiveTool("runtime-test");

    pointer.down(0, 0).move(20, 0).up(20, 0);

    expect(editor.pan.x).toBe(1);
  });

  it("rolls back a drag that ends without completion", () => {
    editor.registerTool({
      ...runtimeManifest(1),
      create: (runtimeEditor) => new RuntimeTool(runtimeEditor, "runtime-test", 1, "leave-open"),
    });
    editor.setActiveTool("runtime-test");

    pointer.down(0, 0).move(20, 0).up(20, 0);

    expect(editor.pan.x).toBe(-1);
  });

  it("rolls back an active drag when its handler throws", () => {
    editor.registerTool({
      ...runtimeManifest(1),
      create: (runtimeEditor) => new RuntimeTool(runtimeEditor, "runtime-test", 1, "throw"),
    });
    editor.setActiveTool("runtime-test");
    pointer.down(0, 0).move(20, 0);

    expect(() => pointer.up(20, 0)).toThrow("runtime drag failed");
    expect(editor.pan.x).toBe(-1);
  });

  it("defers active replacement until a drag finishes", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.setActiveTool("runtime-test");
    pointer.down(0, 0).move(20, 0);

    registration.replace(runtimeManifest(2));
    pointer.move(30, 0);

    expect(editor.pan.x).toBe(1);

    pointer.up(30, 0).click(0, 0);

    expect(editor.pan.x).toBe(2);
  });

  it("cancels an active drag before removing its tool", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.setActiveTool("runtime-test");
    pointer.down(0, 0).move(20, 0);

    registration.dispose();

    expect(editor.pan.x).toBe(-1);
    expect(editor.isDragging).toBe(false);
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("replaces a primary tool while a temporary override is active", () => {
    const registration = editor.registerTool(runtimeManifest(1));
    editor.setActiveTool("runtime-test");
    editor.requestTemporaryTool("hand");

    registration.replace(runtimeManifest(2));
    editor.returnFromTemporaryTool();
    pointer.click(0, 0);

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
