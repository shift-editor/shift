import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { TestEditor } from "@/testing/TestEditor";

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");

describe("shaped proof text attaches only the glyphs the font classes as marks", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FONT, "a");
  });

  /** Lays out `text` in a new run and returns each glyph's drawn origin, once it is shaped into `names`. */
  async function origins(text: string, names: string[]): Promise<Point2D[]> {
    const runId = editor.text.createRun(editor.text.itemsFromText(text)).id;
    const layout = () => editor.text.layoutCell(runId).peek();
    // Literal layout places a spacing glyph the same way, so wait for the shaper's script.
    await expect.poll(() => layout()?.lines[0]?.runs[0]?.script).toBe("Latn");
    const placed = layout()!.placedGlyphs;
    expect(placed.map((glyph) => glyph.glyph.glyphName)).toEqual(names);
    return placed.map((glyph) => glyph.origin);
  }

  it("sets a spacing dieresis beside the letter, though its component lends it a _top anchor", async () => {
    const [a, dieresis] = await origins("a¨", ["a", "dieresis"]);

    expect(a).toEqual({ x: 0, y: 0 });
    // After a's 480-unit advance, on the baseline.
    expect(dieresis).toEqual({ x: 480, y: 0 });
  });

  it("attaches a combining dieresis to the letter's top anchor", async () => {
    const [, mark] = await origins("ä", ["a", "dieresiscomb"]);

    // The mark's _top (150, 500) on a's top (240, 500).
    expect(mark).toEqual({ x: 90, y: 0 });
  });

  it("stacks a second combining dieresis on the first", async () => {
    const [, first, second] = await origins("ä̈", ["a", "dieresiscomb", "dieresiscomb"]);

    expect(first).toEqual({ x: 90, y: 0 });
    // The second mark's _top (150, 500) on the first mark's top (90 + 150, 650).
    expect(second).toEqual({ x: 90, y: 150 });
  });
});
