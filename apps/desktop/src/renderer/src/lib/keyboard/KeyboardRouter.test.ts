import { beforeEach, describe, expect, it } from "vitest";
import type { CommandId } from "@shared/commands";
import { KeyboardRouter } from "./KeyboardRouter";
import { TestEditor } from "@/testing";
import { Mat, Polygon, type Rect2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { GlyphName } from "@shift/types";

type KeyboardEventOptions = Partial<
  Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">
>;

function createKeyboardEvent(options: KeyboardEventOptions = {}): KeyboardEvent {
  const event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "preventDefault"
    | "stopPropagation"
    | "target"
  > = {
    key: options.key ?? "",
    code: options.code ?? "",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: options.target ?? null,
  };

  return event as KeyboardEvent;
}

describe("KeyboardRouter", () => {
  let editor: TestEditor;
  let canvasActive: boolean;
  let command: CommandId | null;
  let router: KeyboardRouter;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    canvasActive = true;
    command = null;

    router = new KeyboardRouter(
      () => ({
        canvasActive,
        activeTool: editor.tool?.id ?? null,
        editor,
        toolManager: editor.toolManager,
      }),
      (id) => {
        command = id;
      },
    );
  });

  describe("zoom shortcuts", () => {
    it("zooms in outside the canvas focus zone", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "=", code: "Equal", metaKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoom).toBeGreaterThan(zoomBefore);
    });

    it("zooms out outside the canvas focus zone", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "-", code: "Minus", ctrlKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoom).toBeLessThan(zoomBefore);
    });

    it("fits scene content with Shift+1 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.setCameraRect({ width: 1000, height: 800 } as Rect2D);
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(300, 100);
      await editor.clickGlyphLocal(300, 300);
      editor.escape();
      editor.setZoom(0.25);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "!", code: "Digit1", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoom).toBeGreaterThan(0.25);
    });

    it("fits selected content with Shift+2 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.setCameraRect({ width: 1000, height: 800 } as Rect2D);
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(300, 100);
      await editor.clickGlyphLocal(300, 300);
      editor.escape();
      editor.selectAll();
      editor.setZoom(0.25);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "@", code: "Digit2", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoom).toBeGreaterThan(0.25);
    });

    it("returns to 100% with Shift+0 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.setZoom(2);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: ")", code: "Digit0", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoom).toBe(1);
    });

    it("does not intercept shift+equal (leaves it for native UI zoom)", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({
        key: "+",
        code: "Equal",
        metaKey: true,
        shiftKey: true,
      });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoom).toBe(zoomBefore);
    });

    it("does not intercept shift+minus (leaves it for native UI zoom)", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({
        key: "_",
        code: "Minus",
        ctrlKey: true,
        shiftKey: true,
      });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoom).toBe(zoomBefore);
    });
  });

  describe("tool shortcuts", () => {
    it("switches tools from canvas shortcuts for non-text tools", async () => {
      const e = createKeyboardEvent({ key: "r" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.toolIf("shape")?.state).toEqual({ type: "ready" });
    });

    it("does not run tool shortcuts outside the canvas context", async () => {
      canvasActive = false;
      const e = createKeyboardEvent({ key: "r" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
    });

    it("does not intercept plain typing while the text tool is active", async () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: "s" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.toolIf("text")?.state).toEqual({ type: "typing" });
    });
  });

  describe("right sidebar shortcuts", () => {
    it.each([
      {
        key: "a",
        code: "KeyA",
        alignment: "left",
        expected: [
          [100, 100],
          [100, 150],
        ],
      },
      {
        key: "h",
        code: "KeyH",
        alignment: "center-h",
        expected: [
          [150, 100],
          [150, 150],
        ],
      },
      {
        key: "d",
        code: "KeyD",
        alignment: "right",
        expected: [
          [200, 100],
          [200, 150],
        ],
      },
      {
        key: "w",
        code: "KeyW",
        alignment: "top",
        expected: [
          [100, 150],
          [200, 150],
        ],
      },
      {
        key: "v",
        code: "KeyV",
        alignment: "center-v",
        expected: [
          [100, 125],
          [200, 125],
        ],
      },
      {
        key: "s",
        code: "KeyS",
        alignment: "bottom",
        expected: [
          [100, 100],
          [200, 100],
        ],
      },
    ])("Alt+$key aligns $alignment", async ({ key, code, expected }) => {
      const ids = await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.selection.select(ids);

      const handled = await router.handleKeyDown(createKeyboardEvent({ key, code, altKey: true }));
      await editor.settle();

      expect(handled).toBe(true);
      expect(
        ids.map((id) => {
          const point = editor.requireGlyphLayer().point(id);
          return [point?.x, point?.y];
        }),
      ).toEqual(expected);
    });

    it.each([
      {
        key: "h",
        code: "KeyH",
        expected: [
          [200, 100],
          [100, 150],
        ],
      },
      {
        key: "v",
        code: "KeyV",
        expected: [
          [100, 150],
          [200, 100],
        ],
      },
    ])("Shift+$key flips the selected points", async ({ key, code, expected }) => {
      const ids = await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.selection.select(ids);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key, code, shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      expect(
        ids.map((id) => {
          const point = editor.requireGlyphLayer().point(id);
          return [point?.x, point?.y];
        }),
      ).toEqual(expected);
    });

    it("flips a selected component through its transform", async () => {
      await editor.addGlyph("flip-base", null);
      const record = editor.font.recordForName("flip-base" as GlyphName);
      if (!record) throw new Error("Expected component glyph");
      const glyph = await editor.font.loadGlyph(record.id);
      const baseLayer = glyph.layerForSource(editor.font.defaultSource.id);
      if (!baseLayer) throw new Error("Expected component layer");
      const contourId = baseLayer.addContour();
      baseLayer.addPoint(contourId, Point.onCurve({ x: 0, y: 0 }));
      baseLayer.addPoint(contourId, Point.onCurve({ x: 100, y: 100 }));
      const componentId = editor.requireGlyphLayer().addComponent(record.id);
      await editor.settle();
      editor.selection.select([componentId]);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "h", code: "KeyH", shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      const component = editor.requireGlyphLayer().components.find(({ id }) => id === componentId);
      if (!component) throw new Error("Expected selected component");
      const transform = Mat.fromDecomposed(component.transform);
      expect(transform.a).toBeCloseTo(-1);
      expect(transform.d).toBeCloseTo(1);
    });

    it.each([
      { key: "u", code: "KeyU", area: 14_600 },
      { key: "i", code: "KeyI", area: 1_600 },
      { key: "s", code: "KeyS", area: 6_500 },
    ])("Alt+Shift+$key applies a Boolean edit", async ({ key, code, area }) => {
      editor.selectTool("shape");
      await editor.dragScene({
        down: { x: 10, y: 10 },
        start: { x: 20, y: 20 },
        end: { x: 100, y: 100 },
      });
      editor.selectTool("shape");
      await editor.dragScene({
        down: { x: 60, y: 60 },
        start: { x: 70, y: 70 },
        end: { x: 150, y: 150 },
      });
      editor.selection.select(editor.requireGlyphLayer().contours.map(({ id }) => id));

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key, code, altKey: true, shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      const contours = editor.requireGlyphLayer().contours;
      expect(contours).toHaveLength(1);
      expect(Polygon.area(contours[0]!.points)).toBeCloseTo(area);
    });

    it("leaves alignment keys available when fewer than two points are selected", async () => {
      const ids = await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.selection.select([ids[0]!]);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "a", code: "KeyA", altKey: true }),
      );

      expect(handled).toBe(false);
      expect(editor.requireGlyphLayer().point(ids[0]!)?.x).toBe(100);
    });

    it("uses the physical key for Option-generated characters", async () => {
      const ids = await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.selection.select(ids);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "å", code: "KeyA", altKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.requireGlyphLayer().point(ids[1]!)?.x).toBe(100);
    });

    it("leaves shortcuts inside inputs alone", async () => {
      const ids = await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.selection.select(ids);
      const input = { tagName: "INPUT" } as EventTarget & { tagName: string };

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "å", code: "KeyA", altKey: true, target: input }),
      );

      expect(handled).toBe(false);
      expect(editor.requireGlyphLayer().point(ids[1]!)?.x).toBe(200);
    });

    it("does not flip while typing with the text tool", async () => {
      editor.selectTool("text");

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "h", code: "KeyH", shiftKey: true }),
      );

      expect(handled).toBe(false);
    });
  });

  describe("selection shortcuts", () => {
    it("records Select All as one undoable editor action", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]);
      editor.selectTool("select");
      editor.selection.clear();

      const handled = await router.handleKeyDown(createKeyboardEvent({ key: "a", metaKey: true }));
      expect(handled).toBe(true);
      expect(editor.selection.ids).toHaveLength(2);

      await editor.undo();
      expect(editor.selection.ids).toEqual([]);
    });
  });

  describe("clipboard shortcuts", () => {
    beforeEach(async () => {
      editor.selectTool("pen");
      await editor.click(100, 100);
      await editor.click(200, 100);
      await editor.click(200, 200);
      await editor.click(100, 200);
      editor.selectTool("select");
      editor.selectAll();
    });

    it("runs paste even when canvas is inactive", async () => {
      await editor.copy();
      const pointsBefore = editor.pointCount;
      canvasActive = false;
      const e = createKeyboardEvent({ key: "v", ctrlKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.pointCount).toBeGreaterThan(pointsBefore);
    });

    it("does not intercept paste while the text tool is active", async () => {
      await editor.copy();
      editor.selectTool("text");
      const pointsBefore = editor.pointCount;
      const e = createKeyboardEvent({ key: "v", metaKey: true });

      await router.handleKeyDown(e);

      expect(editor.pointCount).toBe(pointsBefore);
    });

    it("does not intercept copy while the text tool is active", async () => {
      editor.selectTool("text");
      const bufferBefore = editor.clipboardBuffer;
      const e = createKeyboardEvent({ key: "c", metaKey: true });

      await router.handleKeyDown(e);

      expect(editor.clipboardBuffer).toBe(bufferBefore);
    });

    it("runs Add Component instead of copying", async () => {
      const bufferBefore = editor.clipboardBuffer;
      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "c", metaKey: true, shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(command).toBe("glyph.addComponent");
      expect(editor.clipboardBuffer).toBe(bufferBefore);
    });
  });

  describe("delete key", () => {
    it("deletes the current canvas selection", async () => {
      editor.selectTool("pen");
      await editor.click(100, 100);
      await editor.click(200, 100);
      editor.selectTool("select");
      editor.selectAll();

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "Delete", code: "Delete" }),
      );

      expect(handled).toBe(true);
      expect(editor.pointCount).toBe(0);
      expect(editor.selection.hasSelection()).toBe(false);
    });

    it.each(["Delete", "Backspace"])(
      "%s joins the neighbours of a deleted point into one contour",
      async (key) => {
        const [, middle] = await editor.drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 150 },
          { x: 300, y: 100 },
        ]);
        editor.selectTool("select");
        editor.selection.select([middle!]);

        await router.handleKeyDown(createKeyboardEvent({ key, code: key }));
        await editor.settle();

        expect(editor.requireGlyphLayer().contours).toHaveLength(1);
        expect(editor.pointCount).toBe(2);
      },
    );

    it.each(["Delete", "Backspace"])(
      "Shift+%s leaves a gap instead of joining the neighbours",
      async (key) => {
        const [, middle] = await editor.drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 150 },
          { x: 300, y: 100 },
        ]);
        editor.selectTool("select");
        editor.selection.select([middle!]);

        await router.handleKeyDown(createKeyboardEvent({ key, code: key, shiftKey: true }));
        await editor.settle();

        expect(editor.requireGlyphLayer().contours).toHaveLength(2);
        expect(editor.pointCount).toBe(2);
      },
    );
  });

  describe("temporary hand tool (space)", () => {
    it("activates the hand tool on space and returns to the previous tool on keyup", async () => {
      const down = createKeyboardEvent({ key: " ", code: "Space" });
      const up = createKeyboardEvent({ key: " ", code: "Space" });

      await router.handleKeyDown(down);
      expect(editor.toolIf("hand")?.state).toEqual({ type: "ready" });

      await router.handleKeyUp(up);
      expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
    });

    it("does not activate the hand tool on space while the text tool is active", async () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: " ", code: "Space" });

      await router.handleKeyDown(e);

      expect(editor.toolIf("text")?.state).toEqual({ type: "typing" });
    });
  });

  describe("focus handling", () => {
    it("does not intercept shortcuts while an editable input has focus", async () => {
      const input = { tagName: "INPUT" } as EventTarget & { tagName: string };
      const e = createKeyboardEvent({ key: "a", metaKey: true, target: input });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.selection.hasSelection()).toBe(false);
    });
  });
});
