import { beforeEach, describe, expect, it } from "vitest";
import { glyphTextItem } from "@shift/editor/text";
import type { SpacingTool } from "@shift/editor/tools";
import { TestEditor } from "@/testing/TestEditor";

describe("Spacing tool", () => {
  let editor: TestEditor;

  const hoveredGap = () => {
    const state = editor.toolIf("spacing")?.state;
    return state?.type === "ready" ? (state.hit?.gap ?? null) : undefined;
  };
  const hoveredSide = () => {
    const state = editor.toolIf("spacing")?.state;
    return state?.type === "ready" ? state.hit?.side : undefined;
  };
  const hoverLocal = (x: number, y: number) => {
    const screen = editor.localToScreen({ x, y });
    editor.pointerMove(screen.x, screen.y);
  };

  // Two A's, each a closed square from 100 to 300 in a 500 advance: LSB 100, RSB 200.
  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    for (const [x, y] of [
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
      [100, 100],
    ] as const) {
      await editor.clickLocal(x, y);
    }
    // The default advance; setting it again would record a no-op edit.
    expect(editor.requireGlyphLayer().xAdvance).toBe(500);
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    editor.escape();
    await editor.settle();
    editor.selectTool("spacing");
  });

  it("shows every glyph as plain text while active and restores editing on leaving", () => {
    const child = editor.runGlyph!;
    expect(editor.editing.nodeIds).toEqual([]);

    editor.selectTool("select");
    expect(editor.editing.nodeIds).toEqual([child.id]);
  });

  it("drops the selected half when an undo takes one of its glyphs away", async () => {
    hoverLocal(450, 200);
    const screen = editor.localToScreen({ x: 450, y: 200 });
    editor.click(screen.x, screen.y);
    const tool = () => editor.toolManager.activeTool as SpacingTool;
    expect(tool().currentHalf).not.toBeNull();

    // Undo the typing removes the second A, so the gap between the two is gone.
    await editor.undo();
    await editor.settle();

    expect(tool().currentHalf).toBeNull();
  });

  it("hovering between two glyphs shows the left glyph's RSB and the right glyph's LSB", () => {
    hoverLocal(450, 200);

    expect(hoveredGap()).toMatchObject({
      leftBoundary: 500,
      rightBoundary: 500,
      left: { sidebearing: 200, edge: 300 },
      right: { sidebearing: 100, edge: 600 },
    });
  });

  it("the half under the pointer is the sidebearing a drag would change", () => {
    hoverLocal(450, 200);
    expect(hoveredSide()).toBe("left");

    hoverLocal(550, 200);
    expect(hoveredSide()).toBe("right");
  });

  it("hovering before the first glyph shows only its LSB", () => {
    hoverLocal(50, 200);

    expect(hoveredGap()).toMatchObject({
      leftBoundary: 0,
      rightBoundary: 0,
      left: null,
      right: { sidebearing: 100 },
    });
    expect(hoveredSide()).toBe("right");
  });

  it("hovering inside a glyph's outline, away from its edges, shows no gap", () => {
    hoverLocal(200, 200);

    expect(hoveredGap()).toBeNull();
  });

  it("the gap follows a sidebearing edit", async () => {
    editor.requireGlyphLayer().setXAdvance(520);
    await editor.settle();
    hoverLocal(450, 200);

    expect(hoveredGap()).toMatchObject({
      leftBoundary: 520,
      rightBoundary: 520,
      left: { sidebearing: 220 },
    });
  });

  describe("dragging", () => {
    const layer = () => editor.requireGlyphLayer();
    const drag = (fromX: number, toX: number) =>
      editor.dragLocal({
        down: { x: fromX, y: 200 },
        start: { x: fromX + 4, y: 200 },
        end: { x: toX, y: 200 },
      });

    it("dragging the left half right widens the left glyph's RSB", async () => {
      await drag(450, 470);

      expect(layer().sidebearings).toEqual({ lsb: 100, rsb: 220 });
      expect(layer().xAdvance).toBe(520);
    });

    it("dragging the right half right widens the right glyph's LSB and keeps its RSB", async () => {
      await drag(550, 570);

      expect(layer().sidebearings).toEqual({ lsb: 120, rsb: 200 });
      expect(layer().xAdvance).toBe(520);
    });

    it("snaps to the other sidebearing when dragged close to it", async () => {
      // LSB 100 dragged to 198 lands within a few pixels of the RSB of 200.
      await drag(550, 648);

      expect(layer().sidebearings).toEqual({ lsb: 200, rsb: 200 });
    });

    it("holding the accelerator drags without snapping", async () => {
      await editor.dragLocal({
        down: { x: 550, y: 200 },
        start: { x: 554, y: 200 },
        end: { x: 648, y: 200 },
        options: { metaKey: true },
      });

      expect(layer().sidebearings).toEqual({ lsb: 198, rsb: 200 });
    });

    it("a drag is one undo step", async () => {
      await drag(550, 590);
      await editor.undo();

      expect(layer().sidebearings).toEqual({ lsb: 100, rsb: 200 });
      expect(layer().xAdvance).toBe(500);
    });
  });

  describe("negative sidebearings", () => {
    it("a negative RSB's half covers the overlap and is the one picked there", async () => {
      // RSB -20: the outline ends at 300, past the boundary at 280.
      editor.requireGlyphLayer().setXAdvance(280);
      await editor.settle();
      hoverLocal(290, 200);

      expect(hoveredGap()).toMatchObject({
        leftBoundary: 280,
        rightBoundary: 280,
        left: { sidebearing: -20, edge: 300 },
      });
      expect(hoveredSide()).toBe("left");
    });

    it("a drag can take a sidebearing below zero and keeps following its gap", async () => {
      await editor.dragLocal({
        down: { x: 450, y: 200 },
        start: { x: 446, y: 200 },
        end: { x: 200, y: 200 },
      });

      expect(editor.requireGlyphLayer().sidebearings.rsb).toBe(-50);
      expect(hoveredGap()).toMatchObject({ left: { sidebearing: -50 } });
    });
  });

  describe("typing a value", () => {
    const spacing = () => editor.toolManager.activeTool as SpacingTool;
    const hoveredGapWhileEditing = () => spacing().editing!.gap;
    const editedSide = () => {
      const state = editor.toolIf("spacing")?.state;
      return state?.type === "editing" ? state.hit.side : undefined;
    };
    // The left half's pill sits in its middle: between the outline edge at 300 and the boundary at 500.
    const clickLeftPill = async () => {
      hoverLocal(450, 200);
      const gap = hoveredGap()!;
      const pill = editor.localToScreen({
        x: 400,
        y: (gap.top + gap.bottom) / 2,
      });
      await editor.click(pill.x, pill.y);
    };

    it("hovering the pill marks it and shows the pointer cursor", () => {
      hoverLocal(450, 200);
      const gap = hoveredGap()!;
      hoverLocal(400, (gap.top + gap.bottom) / 2);

      const state = editor.toolIf("spacing")?.state;
      expect(state?.type === "ready" && state.overLabel).toBe(true);
      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({
        type: "pointer",
      });
    });

    it("clicking the active half's pill opens its value; clicking elsewhere in the gap does not", async () => {
      hoverLocal(450, 200);
      const elsewhere = editor.localToScreen({ x: 450, y: 200 });
      await editor.click(elsewhere.x, elsewhere.y);
      expect(editedSide()).toBeUndefined();

      await clickLeftPill();
      expect(editedSide()).toBe("left");
    });

    it("a typed value sets that sidebearing exactly, as one undo step", async () => {
      await clickLeftPill();
      spacing().setEditedSidebearing(150);
      await editor.settle();

      expect(editor.requireGlyphLayer().sidebearings).toEqual({
        lsb: 100,
        rsb: 150,
      });
      expect(spacing().editing?.gap.left?.sidebearing).toBe(150);

      await editor.undo();
      expect(editor.requireGlyphLayer().sidebearings).toEqual({
        lsb: 100,
        rsb: 200,
      });
    });

    it("switching sides edits the other half of the same gap", async () => {
      await clickLeftPill();
      spacing().switchEditedSide();
      spacing().setEditedSidebearing(60);
      await editor.settle();

      expect(editedSide()).toBe("right");
      expect(editor.requireGlyphLayer().sidebearings).toEqual({
        lsb: 60,
        rsb: 200,
      });
    });

    it("a canvas click away from the pill closes it; a click on the pill keeps it open", async () => {
      await clickLeftPill();
      const gap = hoveredGapWhileEditing();
      const pill = editor.localToScreen({
        x: 400,
        y: (gap.top + gap.bottom) / 2,
      });
      await editor.click(pill.x, pill.y);
      expect(editedSide()).toBe("left");

      const away = editor.localToScreen({ x: 200, y: 200 });
      await editor.click(away.x, away.y);
      expect(editor.toolIf("spacing")?.state.type).toBe("ready");
    });

    it("closing returns to hovering", async () => {
      await clickLeftPill();
      spacing().endEditing();

      expect(editor.toolIf("spacing")?.state.type).toBe("ready");
    });
  });

  describe("selecting and nudging", () => {
    const readyState = () => {
      const state = editor.toolIf("spacing")?.state;
      return state?.type === "ready" ? state : undefined;
    };
    const clickLocal = async (x: number, y: number) => {
      hoverLocal(x, y);
      const screen = editor.localToScreen({ x, y });
      await editor.click(screen.x, screen.y);
    };
    const secondItemId = () => editor.text.run(editor.textRun!.runId)!.items[1]!.id;

    it("clicking in a half selects it and makes its glyph the current one", async () => {
      await clickLocal(550, 150);

      expect(readyState()?.selected?.side).toBe("right");
      expect(editor.runGlyph?.itemId).toBe(secondItemId());
    });

    it("arrow keys nudge the selected half and hide the overlays until the pointer moves", async () => {
      await clickLocal(450, 150);
      editor.keyDown("ArrowRight");
      editor.keyDown("ArrowRight", { shiftKey: true });
      await editor.settle();

      expect(editor.requireGlyphLayer().sidebearings).toEqual({
        lsb: 100,
        rsb: 211,
      });
      expect(readyState()?.quiet).toBe(true);

      hoverLocal(460, 150);
      expect(readyState()?.quiet).toBeFalsy();
    });

    it("with nothing selected, arrow keys nudge the hovered half", async () => {
      hoverLocal(550, 150);
      editor.keyDown("ArrowLeft");
      await editor.settle();

      expect(editor.requireGlyphLayer().sidebearings).toEqual({
        lsb: 99,
        rsb: 200,
      });
    });

    it("Tab walks the halves in reading order and Shift-Tab walks back", async () => {
      await clickLocal(450, 150);
      const items = editor.text.run(editor.textRun!.runId)!.items;
      const selectedHalf = () => {
        const selected = readyState()?.selected;
        const half = selected?.gap[selected.side];
        return selected && half
          ? `${selected.side}:${items.findIndex((item) => item.id === half.itemId)}`
          : null;
      };
      expect(selectedHalf()).toBe("left:0");

      editor.keyDown("Tab");
      expect(selectedHalf()).toBe("right:1");
      expect(editor.runGlyph?.itemId).toBe(items[1]!.id);

      editor.keyDown("Tab");
      expect(selectedHalf()).toBe("left:1");

      editor.keyDown("Tab", { shiftKey: true });
      editor.keyDown("Tab", { shiftKey: true });
      expect(selectedHalf()).toBe("left:0");
    });

    it("Escape clears the selection", async () => {
      await clickLocal(450, 150);
      editor.keyDown("Escape");

      expect(readyState()?.selected).toBeNull();
    });

    it("leaving Spacing edits the glyph that was selected", async () => {
      await clickLocal(550, 150);
      editor.selectTool("select");

      expect(editor.editing.nodeIds).toEqual([editor.runGlyph!.id]);
      expect(editor.runGlyph?.itemId).toBe(secondItemId());
    });
  });
});
