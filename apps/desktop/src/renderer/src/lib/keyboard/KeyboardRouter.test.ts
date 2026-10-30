import { beforeEach, describe, expect, it } from "vitest";
import type { CommandId } from "@shared/commands";
import type { Editor } from "@shift/editor";
import { Polygon, type Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";
import { KeyboardRouter } from "./KeyboardRouter";
import type { KeyContext } from "./types";

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

/** The context the canvas hands the router, built from the editor as the editor view builds it. */
function canvasContext(editor: Editor, canvasActive: boolean): KeyContext {
  return {
    canvasActive,
    activeTool: editor.tool?.id ?? null,
    editor,
    toolManager: editor.toolManager,
  };
}

describe("KeyboardRouter", () => {
  let editor: EditorTestSurface;
  let canvasActive: boolean;
  let command: CommandId | null;
  let router: KeyboardRouter;

  /** Draws an open contour through `points` and returns its point ids, in order. */
  async function drawOpenContour(points: readonly Point2D[]): Promise<PointId[]> {
    await editor.draw({ contours: [{ points: points.map(({ x, y }) => [x, y] as const) }] });
    const [contour] = await editor.outline();
    if (!contour) throw new Error("Expected the drawn contour");
    return contour.points.map(({ id }) => id);
  }

  /** How many points the open glyph has, across its contours. */
  async function pointCount(): Promise<number> {
    return (await editor.outline()).flatMap(({ points }) => points).length;
  }

  /** Where each point is, as `[x, y]`. */
  async function positions(ids: readonly PointId[]): Promise<(number | undefined)[][]> {
    const points = await Promise.all(ids.map((id) => editor.point(id)));
    return points.map((point) => [point?.x, point?.y]);
  }

  beforeEach(async () => {
    editor = await startTestEditor();
    canvasActive = true;
    command = null;

    router = new KeyboardRouter(
      () => canvasContext(editor.asEditor(), canvasActive),
      (id) => {
        command = id;
      },
    );
  });

  describe("zoom shortcuts", () => {
    it("zooms in outside the canvas focus zone", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoomLevel();
      const e = createKeyboardEvent({ key: "=", code: "Equal", metaKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoomLevel()).toBeGreaterThan(zoomBefore);
    });

    it("zooms out outside the canvas focus zone", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoomLevel();
      const e = createKeyboardEvent({ key: "-", code: "Minus", ctrlKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoomLevel()).toBeLessThan(zoomBefore);
    });

    it("fits scene content with Shift+1 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.resizeCanvas(1000, 800);
      editor.selectTool("pen");
      await editor.clickAt({ x: 100, y: 100 });
      await editor.clickAt({ x: 300, y: 100 });
      await editor.clickAt({ x: 300, y: 300 });
      await editor.pressKey("Escape");
      editor.setZoom(0.25);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "!", code: "Digit1", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoomLevel()).toBeGreaterThan(0.25);
    });

    it("fits selected content with Shift+2 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.resizeCanvas(1000, 800);
      editor.selectTool("pen");
      await editor.clickAt({ x: 100, y: 100 });
      await editor.clickAt({ x: 300, y: 100 });
      await editor.clickAt({ x: 300, y: 300 });
      await editor.pressKey("Escape");
      editor.selectAll();
      editor.setZoom(0.25);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "@", code: "Digit2", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoomLevel()).toBeGreaterThan(0.25);
    });

    it("returns to 100% with Shift+0 outside the canvas focus zone", async () => {
      canvasActive = false;
      editor.setZoom(2);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: ")", code: "Digit0", shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(editor.zoomLevel()).toBe(1);
    });

    it("does not intercept shift+equal (leaves it for native UI zoom)", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoomLevel();
      const e = createKeyboardEvent({
        key: "+",
        code: "Equal",
        metaKey: true,
        shiftKey: true,
      });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoomLevel()).toBe(zoomBefore);
    });

    it("does not intercept shift+minus (leaves it for native UI zoom)", async () => {
      canvasActive = false;
      const zoomBefore = editor.zoomLevel();
      const e = createKeyboardEvent({
        key: "_",
        code: "Minus",
        ctrlKey: true,
        shiftKey: true,
      });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoomLevel()).toBe(zoomBefore);
    });
  });

  describe("tool shortcuts", () => {
    it("switches tools from canvas shortcuts for non-text tools", async () => {
      const e = createKeyboardEvent({ key: "r" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.toolState()).toEqual({ id: "shape", state: "ready" });
    });

    it("does not run tool shortcuts outside the canvas context", async () => {
      canvasActive = false;
      const e = createKeyboardEvent({ key: "r" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
    });

    it("keeps Tab on the canvas from moving focus, before any binding runs", () => {
      let prevented = false;
      const e = {
        ...createKeyboardEvent({ key: "Tab" }),
        preventDefault: () => (prevented = true),
      };

      void router.handleKeyDown(e as KeyboardEvent);

      expect(prevented).toBe(true);
    });

    it("leaves Tab to move focus outside the canvas", () => {
      canvasActive = false;
      let prevented = false;
      const e = {
        ...createKeyboardEvent({ key: "Tab" }),
        preventDefault: () => (prevented = true),
      };

      void router.handleKeyDown(e as KeyboardEvent);

      expect(prevented).toBe(false);
    });

    it("does not intercept plain typing in Text mode", async () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: "r" });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
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
      const ids = await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.select(ids);

      const handled = await router.handleKeyDown(createKeyboardEvent({ key, code, altKey: true }));
      await editor.settle();

      expect(handled).toBe(true);
      expect(await positions(ids)).toEqual(expected);
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
      const ids = await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.select(ids);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key, code, shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      expect(await positions(ids)).toEqual(expected);
    });

    it("flips a selected component through its transform", async () => {
      await editor.addGlyph("flip-base", null);
      await editor.openGlyph("flip-base");
      await editor.draw({
        contours: [
          {
            points: [
              [0, 0],
              [100, 100],
            ],
          },
        ],
      });
      await editor.openGlyph("A");
      await editor.draw({ components: [{ glyph: "flip-base" }] });
      const [added] = await editor.components();
      if (!added) throw new Error("Expected the added component");
      editor.selectObjects([added.id]);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "h", code: "KeyH", shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      const [component] = await editor.components();
      if (component?.id !== added.id) throw new Error("Expected selected component");
      expect(component.transformation.xx).toBeCloseTo(-1);
      expect(component.transformation.yy).toBeCloseTo(1);
    });

    it.each([
      { key: "u", code: "KeyU", area: 14_600 },
      { key: "i", code: "KeyI", area: 1_600 },
      { key: "s", code: "KeyS", area: 6_500 },
    ])("Alt+Shift+$key applies a Boolean edit", async ({ key, code, area }) => {
      editor.selectTool("shape");
      await editor.dragFrom({ x: 10, y: 10 }, { x: 100, y: 100 });
      editor.selectTool("shape");
      await editor.dragFrom({ x: 60, y: 60 }, { x: 150, y: 150 });
      editor.selectObjects((await editor.outline()).map(({ id }) => id));

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key, code, altKey: true, shiftKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      const contours = await editor.outline();
      expect(contours).toHaveLength(1);
      expect(Polygon.area(contours[0]!.points)).toBeCloseTo(area);
    });

    it("leaves alignment keys available when fewer than two points are selected", async () => {
      const ids = await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.select([ids[0]!]);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "a", code: "KeyA", altKey: true }),
      );

      expect(handled).toBe(false);
      expect(await editor.point(ids[0]!)).toMatchObject({ x: 100 });
    });

    it("uses the physical key for Option-generated characters", async () => {
      const ids = await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.select(ids);

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "å", code: "KeyA", altKey: true }),
      );
      await editor.settle();

      expect(handled).toBe(true);
      expect(await editor.point(ids[1]!)).toMatchObject({ x: 100 });
    });

    it("leaves shortcuts inside inputs alone", async () => {
      const ids = await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
      ]);
      editor.selectTool("select");
      editor.select(ids);
      const input = { tagName: "INPUT" } as EventTarget & { tagName: string };

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "å", code: "KeyA", altKey: true, target: input }),
      );

      expect(handled).toBe(false);
      expect(await editor.point(ids[1]!)).toMatchObject({ x: 200 });
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
      await drawOpenContour([
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]);
      editor.selectTool("select");
      editor.select([]);

      const handled = await router.handleKeyDown(createKeyboardEvent({ key: "a", metaKey: true }));
      expect(handled).toBe(true);
      expect(editor.selectionIds()).toHaveLength(2);

      await editor.undo();
      expect(editor.selectionIds()).toEqual([]);
    });
  });

  describe("clipboard shortcuts", () => {
    beforeEach(async () => {
      editor.selectTool("pen");
      await editor.clickAt({ x: 100, y: 100 });
      await editor.clickAt({ x: 200, y: 100 });
      await editor.clickAt({ x: 200, y: 200 });
      await editor.clickAt({ x: 100, y: 200 });
      editor.selectTool("select");
      editor.selectAll();
    });

    it("runs paste even when canvas is inactive", async () => {
      await editor.copy();
      const pointsBefore = await pointCount();
      canvasActive = false;
      const e = createKeyboardEvent({ key: "v", ctrlKey: true });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(await pointCount()).toBeGreaterThan(pointsBefore);
    });

    it("does not intercept paste in Text mode", async () => {
      await editor.copy();
      editor.selectTool("text");
      const pointsBefore = await pointCount();
      const e = createKeyboardEvent({ key: "v", metaKey: true });

      await router.handleKeyDown(e);

      expect(await pointCount()).toBe(pointsBefore);
    });

    it("does not intercept copy in Text mode", async () => {
      editor.selectTool("text");
      const bufferBefore = editor.clipboardText();
      const e = createKeyboardEvent({ key: "c", metaKey: true });

      await router.handleKeyDown(e);

      expect(editor.clipboardText()).toBe(bufferBefore);
    });

    it("runs Add Component instead of copying", async () => {
      const bufferBefore = editor.clipboardText();
      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "c", metaKey: true, shiftKey: true }),
      );

      expect(handled).toBe(true);
      expect(command).toBe("glyph.addComponent");
      expect(editor.clipboardText()).toBe(bufferBefore);
    });
  });

  describe("delete key", () => {
    it("deletes the current canvas selection", async () => {
      editor.selectTool("pen");
      await editor.clickAt({ x: 100, y: 100 });
      await editor.clickAt({ x: 200, y: 100 });
      editor.selectTool("select");
      editor.selectAll();

      const handled = await router.handleKeyDown(
        createKeyboardEvent({ key: "Delete", code: "Delete" }),
      );

      expect(handled).toBe(true);
      expect(await pointCount()).toBe(0);
      expect(editor.selectionIds()).toEqual([]);
    });

    it.each(["Delete", "Backspace"])(
      "%s joins the neighbours of a deleted point into one contour",
      async (key) => {
        const [, middle] = await drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 150 },
          { x: 300, y: 100 },
        ]);
        editor.selectTool("select");
        editor.select([middle!]);

        await router.handleKeyDown(createKeyboardEvent({ key, code: key }));
        await editor.settle();

        expect(await editor.outline()).toHaveLength(1);
        expect(await pointCount()).toBe(2);
      },
    );

    it.each(["Delete", "Backspace"])(
      "Shift+%s leaves a gap instead of joining the neighbours",
      async (key) => {
        const [, middle] = await drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 150 },
          { x: 300, y: 100 },
        ]);
        editor.selectTool("select");
        editor.select([middle!]);

        await router.handleKeyDown(createKeyboardEvent({ key, code: key, shiftKey: true }));
        await editor.settle();

        expect(await editor.outline()).toHaveLength(2);
        expect(await pointCount()).toBe(2);
      },
    );

    it("Shift+Backspace leaves two open fragments with exact undo and redo", async () => {
      const ids = await drawOpenContour([0, 100, 200, 300, 400].map((x) => ({ x, y: 100 })));
      editor.selectTool("select");
      editor.select([ids[2]!]);
      const source = editor.source("active")?.name;
      if (!source) throw new Error("Expected an active source");
      const before = await editor.layerAt(source);

      await router.handleKeyDown(
        createKeyboardEvent({ key: "Backspace", code: "Backspace", shiftKey: true }),
      );
      await editor.settle();
      const after = await editor.layerAt(source);
      expect(after.contours.map((contour) => contour.points.map((point) => point.id))).toEqual([
        ids.slice(0, 2),
        ids.slice(3),
      ]);
      expect(after.contours.map((contour) => contour.closed)).toEqual([false, false]);

      await editor.undo();
      expect(await editor.layerAt(source)).toEqual(before);
      await editor.redo();
      expect(await editor.layerAt(source)).toEqual(after);
    });

    it.each([
      ["Backspace", false],
      ["Delete", true],
    ])(
      "%s with Shift=%s on a cubic handle removes both controls without changing the next curve",
      async (key, shiftKey) => {
        editor.selectTool("pen");
        await editor.clickAt({ x: 0, y: 0 });
        for (const [x, y] of [
          [200, -100],
          [400, 100],
        ] as const) {
          await editor.dragFrom({ x, y: 0 }, { x, y });
        }
        editor.selectTool("select");
        const [before] = await editor.outline();
        const [start, controlStart, controlEnd, end, ...next] = before?.points ?? [];
        if (
          !start ||
          controlStart?.pointType !== "offCurve" ||
          controlEnd?.pointType !== "offCurve" ||
          !end
        ) {
          throw new Error("Expected the first segment to be cubic");
        }
        editor.select([controlStart.id]);

        await router.handleKeyDown(createKeyboardEvent({ key, code: key, shiftKey }));
        await editor.settle();

        const [after] = await editor.outline();
        const nextCurve = [end, ...next];
        // A line from start to end, then the next cubic, its points in place.
        expect(after?.points.map(({ pointType }) => pointType)).toEqual([
          "onCurve",
          "onCurve",
          "offCurve",
          "offCurve",
          "onCurve",
        ]);
        expect(after?.points.slice(0, 2).map(({ id }) => id)).toEqual([start.id, end.id]);
        expect(after?.points.slice(1).map(({ id }) => id)).toEqual(nextCurve.map(({ id }) => id));
        expect(after?.points.slice(1).map(({ x, y }) => ({ x, y }))).toEqual(
          nextCurve.map(({ x, y }) => ({ x, y })),
        );
      },
    );
  });

  describe("temporary hand tool (space)", () => {
    it("activates the hand tool on space and returns to the previous tool on keyup", async () => {
      const down = createKeyboardEvent({ key: " ", code: "Space" });
      const up = createKeyboardEvent({ key: " ", code: "Space" });

      await router.handleKeyDown(down);
      expect(editor.toolState()).toEqual({ id: "hand", state: "ready" });

      await router.handleKeyUp(up);
      expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
    });

    it("does not activate the hand tool on space in Text mode", async () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: " ", code: "Space" });

      await router.handleKeyDown(e);

      expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
    });
  });

  describe("focus handling", () => {
    it("does not intercept shortcuts while an editable input has focus", async () => {
      const input = { tagName: "INPUT" } as EventTarget & { tagName: string };
      const e = createKeyboardEvent({ key: "a", metaKey: true, target: input });

      const handled = await router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.selectionIds()).toEqual([]);
    });
  });
});
