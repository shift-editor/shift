import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const ROUND_20: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

/** The notice a run shows while a glyph's strokes are hidden between masters. */
const HIDDEN_BETWEEN_MASTERS = /authored sources only/;

describe("dynamic strokes in a text run", () => {
  // MutatorSans A is edited at its default source; the run draws a second A beside it.
  const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "A" });

  /** Gives A's first contour a dynamic stroke, then types a second A and records the canvas. */
  async function strokedAInRun(): Promise<void> {
    const [contour] = await editor.outline();
    editor.select([contour!.points[0]!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.settle();
    editor.recordCanvas();
  }

  /**
   * How many times the latest frame fills A's solved strokes: once for the edited A and once for
   * each A the run draws, so the run's own fill is what takes this to two.
   */
  const strokeFillsDrawn = () => {
    const { strokeFills } = editor.drawnOutlineIds("A");
    if (strokeFills === null) return 0;

    return editor.latestCanvasFrame().fills.filter((fill) => fill === strokeFills).length;
  };

  it("fills the solved stroke of a glyph drawn at an authored source", async () => {
    await strokedAInRun();

    await expect.poll(strokeFillsDrawn).toBe(2);
    expect(editor.strokeProblems()).toEqual([]);
  });

  it("draws the glyph as it does without strokes between masters, and says so once", async () => {
    await strokedAInRun();
    await expect.poll(strokeFillsDrawn).toBe(2);

    editor.setLocation({ wdth: 0, wght: 500 });
    await expect
      .poll(() => editor.strokeProblems().filter((message) => HIDDEN_BETWEEN_MASTERS.test(message)))
      .toHaveLength(1);

    expect(strokeFillsDrawn()).toBe(0);
    // Each move to another place between masters draws the run again.
    for (const wght of [600, 700, 800]) {
      const framesBefore = editor.canvasFrameCount();
      editor.setLocation({ wdth: 0, wght });
      await expect.poll(() => editor.canvasFrameCount()).toBeGreaterThan(framesBefore);
    }
    expect(editor.strokeProblems()).toHaveLength(1);
  });

  it("says nothing between masters when no glyph in the run has a dynamic stroke", async () => {
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.settle();
    editor.recordCanvas();

    editor.setLocation({ wdth: 0, wght: 500 });
    const framesBefore = editor.canvasFrameCount();
    await expect.poll(() => editor.canvasFrameCount()).toBeGreaterThan(framesBefore);

    expect(editor.strokeProblems()).toEqual([]);
  });

  it("shows the strokes again, and no second notice for them, once back on a source", async () => {
    await strokedAInRun();
    editor.setLocation({ wdth: 0, wght: 500 });
    await expect.poll(() => editor.strokeProblems().length).toBe(1);

    editor.clickSource("LightCondensed");

    await expect.poll(strokeFillsDrawn).toBe(2);
    expect(editor.strokeProblems()).toHaveLength(1);
  });
});

describe("a dynamic stroke that cannot be solved, in a text run", () => {
  const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "A" });

  /** Draws a line in A, strokes it, and drags its end onto its start so the stroke cannot be solved. */
  async function collapsedStrokeInA(): Promise<void> {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    editor.selectTool("select");
    const line = (await editor.outline()).at(-1)!;
    const [start, end] = line.points;
    editor.select([start!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
    await editor.settle();
    await editor.dragPoint(end!.id as PointId, { x: -300, y: 0 });
    await editor.settle();
  }

  it("still says the run's strokes are hidden between masters", async () => {
    await collapsedStrokeInA();
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.settle();
    editor.recordCanvas();

    editor.setLocation({ wdth: 0, wght: 500 });

    await expect
      .poll(() => editor.strokeProblems().filter((message) => HIDDEN_BETWEEN_MASTERS.test(message)))
      .toHaveLength(1);
  });
});

describe("a dynamic stroke that cannot be solved, in a run with a feature highlighted", () => {
  const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "i" });

  /**
   * The problems reported once i's stroke collapses, with a second i in the run and "liga" off, so
   * the feature names i. The edited i says it once, and so does the run drawing the other.
   */
  async function problemsAfterCollapse(highlighted: boolean): Promise<readonly string[]> {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    editor.selectTool("select");
    const line = (await editor.outline()).at(-1)!;
    const [start, end] = line.points;
    editor.select([start!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
    await editor.settle();

    editor.selectTool("text");
    editor.typeText("i");
    await editor.pressKey("Escape");
    await editor.settle();
    editor.recordCanvas();
    editor.setTextFeature("liga", false);
    if (highlighted) editor.highlightFeature("liga");
    editor.selectTool("select");
    await editor.settle();
    await editor.dragPoint(end!.id as PointId, { x: -300, y: 0 });
    await editor.settle();

    return editor.strokeProblems();
  }

  it("reports the failure once for the edited glyph and once for the run, with no feature highlighted", async () => {
    expect(await problemsAfterCollapse(false)).toHaveLength(2);
  });

  it("reports the run's failure just the same when the glyph that failed is highlighted", async () => {
    expect(await problemsAfterCollapse(true)).toHaveLength(2);
  });
});
