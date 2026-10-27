import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "./surface";
import { resolve } from "node:path";
import { startTestEditor, TestEditor } from "./TestEditor";

const MUTATOR_SANS = resolve(process.cwd(), "../../fixtures/fonts/MutatorSansVariable.glyphs");

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("draw builds a fixture through the editor", () => {
  it("returns the ids of exactly the points a fixture names", async () => {
    const ids = await editor.draw({
      contours: [
        {
          closed: true,
          points: [{ x: 0, y: 0, name: "start" }, [100, 0], { x: 50, y: 80, off: true }],
        },
      ],
    });

    expect(Object.keys(ids)).toEqual(["start"]);
    // @ts-expect-error -- `draw` returns only the names the fixture used, so a misspelt name is a type error.
    expect(ids.strat).toBeUndefined();
  });

  it("draws contours, smooth and off-curve points as the outline stores them", async () => {
    const { top } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            [0, 0],
            { x: 0, y: 80, off: true },
            { x: 50, y: 100, smooth: true, name: "top" },
            [100, 0],
          ],
        },
      ],
    });

    expect(await editor.outline()).toMatchObject([
      {
        closed: true,
        points: [
          expect.objectContaining({ x: 0, y: 0, pointType: "onCurve", smooth: false }),
          expect.objectContaining({ x: 0, y: 80, pointType: "offCurve" }),
          { id: top, x: 50, y: 100, pointType: "onCurve", smooth: true },
          expect.objectContaining({ x: 100, y: 0, pointType: "onCurve" }),
        ],
      },
    ]);
  });

  it("names anchors as the fixture says", async () => {
    await editor.draw({ advance: 500, anchors: [{ name: "top", x: 250, y: 700 }] });

    expect(await editor.anchors()).toEqual([
      expect.objectContaining({ name: "top", x: 250, y: 700 }),
    ]);
  });

  it("offsets components as the fixture says", async () => {
    const font = await new TestEditor().openSession(MUTATOR_SANS, "I");
    try {
      await font.draw({ components: [{ glyph: "A", x: 150, y: 20 }] });

      expect(await font.components()).toContainEqual(
        expect.objectContaining({
          baseGlyphName: "A",
          transformation: expect.objectContaining({ dx: 150, dy: 20 }),
        }),
      );
    } finally {
      await font.close();
    }
  });
});
