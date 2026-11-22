import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const ROUND_40 = {
  width: 40,
  cap: "round" as const,
  join: "round" as const,
  miterLimit: 4,
  position: 0,
};

// REPRO (2026-11-23): instances of a glyph whose contours carry a dynamic
// stroke render the skeleton, not the ink. Base `o` is a closed rect
// (-80,-80,160x160) with a 40-wide round stroke: its ink is a ring spanning
// -100..100. `oref` places `o` at x+50, so its ink spans -50..150 and its
// skeleton spans -30..130. `oref2` places `oref` again (nested instance).
describe("a component instance of a dynamically stroked glyph", () => {
  const editor = useTestEditor({
    glyphs: {
      o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      oref: { outline: { advance: 600, components: [{ glyph: "o", x: 50 }] } },
      oref2: { outline: { advance: 600, components: [{ glyph: "oref", x: 50 }] } },
    },
    open: "oref",
  });

  async function strokeBase() {
    await editor.openGlyph("o");
    const [contour] = await editor.outline();
    editor.select(contour!.points.map((point) => point.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();
  }

  it("control: the base glyph itself draws its stroke fills", async () => {
    await strokeBase();

    expect(editor.drawnOutlineIds("o").strokeFills).not.toBeNull();
  });

  it("the instance draws the base's stroke fills, transformed", async () => {
    await strokeBase();
    await editor.openGlyph("oref");
    editor.recordCanvas();

    expect(editor.drawnOutlineIds("oref").componentStrokeFills).not.toBeNull();
    expect(editor.strokeProblems()).toEqual([]);

    // What the frame fills is the base's ink ring (-100..100) under the +50
    // placement — two outlines, outer and hole — never the skeleton rect
    // (-30..130) the ring replaces.
    await expect.poll(() => editor.canvasFills()).toHaveLength(2);
    const xs = editor
      .canvasFills()
      .flatMap((contour) => contour.coordinates.filter((_, index) => index % 2 === 0));
    expect(Math.min(...xs)).toBeCloseTo(-50, 0);
    expect(Math.max(...xs)).toBeCloseTo(150, 0);
  });

  it("the instance's sidebearings read the ink, as the base's do", async () => {
    await strokeBase();

    const base = await editor.drawnGlyph("o");
    const instance = await editor.drawnGlyph("oref");

    // Ink: base lsb -100; instance is base shifted +50 with advance 600.
    expect(base.sidebearings).toEqual({ lsb: -100, rsb: 500 });
    expect(instance.sidebearings).toEqual({ lsb: -50, rsb: 450 });
  });

  it("a text run of the instance fills the ink ring, never the skeleton", async () => {
    await strokeBase();
    const pageId = await editor.openGlyphsAsText(["oref"]);
    editor.showPage(pageId!);
    editor.recordCanvas();

    // Display drawing fills the placed ink ring's two outlines (outer edge
    // and skeleton edge). Without the skeleton exclusion the base's rect
    // would fill as a third. Poll on the placed edge: frames of the page
    // being left can land first.
    const minX = () => {
      const xs = editor
        .canvasFills()
        .flatMap((contour) => contour.coordinates.filter((_, index) => index % 2 === 0));
      return xs.length > 0 ? Math.min(...xs) : null;
    };
    await expect.poll(minX).toBeCloseTo(-50, 0);
    expect(editor.canvasFills()).toHaveLength(2);
  });

  it("a nested instance draws the stroke fills too", async () => {
    await strokeBase();
    await editor.openGlyph("oref2");

    expect(editor.drawnOutlineIds("oref2").componentStrokeFills).not.toBeNull();
  });
});

describe("a component instance between masters", () => {
  const editor = useTestEditor({
    axes: [WEIGHT],
    sources: { Bold: { wght: 700 } },
    glyphs: {
      o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      oref: { outline: { advance: 600, components: [{ glyph: "o", x: 50 }] } },
    },
    open: "oref",
  });

  it("shows the instance's stroke at its authored source only", async () => {
    editor.clickSource("Regular");
    await editor.openGlyph("o");
    const [contour] = await editor.outline();
    editor.select(contour!.points.map((point) => point.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    await editor.openGlyph("oref");
    expect(editor.drawnOutlineIds("oref").componentStrokeFills).not.toBeNull();

    editor.setLocation({ wght: 350 });
    expect(editor.drawnOutlineIds("oref").componentStrokeFills).toBeNull();
  });
});

describe("an instance whose base stroke cannot be solved", () => {
  const editor = useTestEditor({
    glyphs: {
      // A rectangle with no size: the solver has no path to follow.
      bad: { outline: { advance: 600, contours: [rect(100, 100, 0, 0)] } },
      badref: { outline: { advance: 600, components: [{ glyph: "bad", x: 50 }] } },
    },
    open: "badref",
  });

  it("reports the solve failure on the instance, as on the base", async () => {
    await editor.openGlyph("bad");
    const [contour] = await editor.outline();
    editor.select(contour!.points.map((point) => point.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();
    editor.recordCanvas();
    await expect.poll(() => editor.strokeProblems()).toHaveLength(1);

    await editor.openGlyph("badref");
    editor.recordCanvas();

    // The instance solves the same base, so the failure is reported for its
    // node too, and there is nothing solved to fill.
    await expect.poll(() => editor.strokeProblems()).toHaveLength(2);
    expect(editor.strokeProblems()[1]).toMatch(/^A dynamic stroke could not be drawn: .+\.$/);
    expect(editor.drawnOutlineIds("badref").componentStrokeFills).toBeNull();
  });
});
