import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// `bullet` places `period` at scale 1 in Light (wght 100) and 3 in Bold
// (wght 700); `bar` mirrors it and doubles its height in Bold. Compiled fonts
// interpolate both decomposed, so halfway they draw the blend of each
// master's placed outline, not the blended transform applied to the blended
// base. `ringbig` scales `ring`, whose intermediate master at wght 250 the
// decomposed glyph keeps. `wedgeflip` mirrors `wedge` in Bold only, so the
// compiler reverses that master's contour. `wedgenest` mirrors `wedgeflip`
// in Bold, so Bold's wedge is mirrored twice and keeps its order. The
// expected bounds are the exported font's.
const editor = useTestEditor({ file: FONTS.scaledComponent, glyph: "bullet" });

describe("components that change scale between masters interpolate like the compiled font", () => {
  it("draws a scaled component's outline as the exported font does halfway", async () => {
    editor.setLocation({ wght: 400 });

    expect((await editor.drawnGlyph("bullet")).bounds).toEqual({
      min: { x: 50, y: 100 },
      max: { x: 400, y: 450 },
    });
  });

  it("draws a mirrored component's outline as the exported font does halfway", async () => {
    editor.setLocation({ wght: 400 });

    expect((await editor.drawnGlyph("bar")).bounds).toEqual({
      min: { x: 250, y: 0 },
      max: { x: 400, y: 250 },
    });
  });

  it("keeps a component's intermediate master in the decomposed outline", async () => {
    // Samples at wght 100 (ring 100 wide, scale 1) and 250 (ring 250 wide,
    // scale 1.25), two thirds of the way: 150 + (362.5 - 150) * 2 / 3.
    editor.setLocation({ wght: 200 });

    expect(await editor.drawnGlyph("ringbig")).toMatchObject({
      bounds: { max: expect.toBeNear({ x: 291.667, y: 241.667 }) },
    });
  });

  it("pairs points as the compiler does when one master mirrors its component", async () => {
    editor.setLocation({ wght: 400 });

    expect((await editor.drawnGlyph("wedgeflip")).bounds).toEqual({
      min: { x: 150, y: 0 },
      max: { x: 300, y: 150 },
    });
  });

  // A nested composite drawn before its middle component draws nothing, so
  // these draw `wedgeflip` first.
  it("pairs points as the compiler does when nested mirrors cancel", async () => {
    // Light places the wedge at (50,0) (150,0) (50,200); Bold mirrors it
    // twice, to (50,0) (250,0) (50,300) in order. Reversing it once would
    // pair (250,0) with (50,200) and stop at x 150.
    editor.setLocation({ wght: 400 });
    await editor.drawnGlyph("wedgeflip");

    expect((await editor.drawnGlyph("wedgenest")).bounds).toEqual({
      min: expect.toBeNear({ x: 50, y: 0 }),
      max: expect.toBeNear({ x: 200, y: 250 }),
    });
  });

  it("draws each master of a nested component exactly as authored", async () => {
    editor.setLocation({ wght: 100 });
    await editor.drawnGlyph("wedgeflip");
    expect((await editor.drawnGlyph("wedgenest")).bounds).toEqual({
      min: expect.toBeNear({ x: 50, y: 0 }),
      max: expect.toBeNear({ x: 150, y: 200 }),
    });

    editor.setLocation({ wght: 700 });
    await editor.drawnGlyph("wedgeflip");
    expect((await editor.drawnGlyph("wedgenest")).bounds).toEqual({
      min: expect.toBeNear({ x: 50, y: 0 }),
      max: expect.toBeNear({ x: 250, y: 300 }),
    });
  });

  it("follows an edit to a component's master between masters", async () => {
    await editor.openGlyph("period");
    await editor.editSources(["Bold"]);
    const corner = await editor.pointAt({ x: 200, y: 200 });
    editor.select([corner!.id]);

    // Bold places period at scale 3 from (50,100): moving its corner to
    // (300,200) moves the placed corner to (950,700); halfway from Light's
    // (150,200) that is (550,450).
    await editor.dragPoint(corner!.id, { x: 100, y: 0 });

    editor.setLocation({ wght: 400 });
    expect(await editor.drawnGlyph("bullet")).toMatchObject({
      bounds: { max: { x: 550, y: 450 } },
    });
  });

  it("keeps the occurrence a component of its base glyph between masters", async () => {
    editor.setLocation({ wght: 400 });
    const bullet = await editor.drawnGlyph("bullet");

    expect(bullet).toMatchObject({ components: [{ glyph: "period", bounds: bullet.bounds }] });
  });

  it("draws a master exactly as authored", async () => {
    editor.setLocation({ wght: 700 });

    expect((await editor.drawnGlyph("bullet")).bounds).toEqual({
      min: { x: 50, y: 100 },
      max: { x: 650, y: 700 },
    });
  });
});
