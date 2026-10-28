import { describe, expect, it } from "vitest";
import type { Bounds } from "@shift/geo";
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

async function drawnAt(glyph: string, weight: number) {
  editor.setLocation({ wght: weight });
  return editor.drawnGlyph(glyph);
}

async function boundsAt(glyph: string, weight: number): Promise<Bounds> {
  const { bounds } = await drawnAt(glyph, weight);
  if (!bounds) throw new Error(`Expected ${glyph} to draw an outline`);
  return bounds;
}

function expectBounds(bounds: Bounds, [minX, minY, maxX, maxY]: number[]): void {
  expect(bounds.min.x).toBeCloseTo(minX!);
  expect(bounds.min.y).toBeCloseTo(minY!);
  expect(bounds.max.x).toBeCloseTo(maxX!);
  expect(bounds.max.y).toBeCloseTo(maxY!);
}

describe("components that change scale between masters interpolate like the compiled font", () => {
  it("draws a scaled component's outline as the exported font does halfway", async () => {
    expect(await boundsAt("bullet", 400)).toEqual({
      min: { x: 50, y: 100 },
      max: { x: 400, y: 450 },
    });
  });

  it("draws a mirrored component's outline as the exported font does halfway", async () => {
    expect(await boundsAt("bar", 400)).toEqual({ min: { x: 250, y: 0 }, max: { x: 400, y: 250 } });
  });

  it("keeps a component's intermediate master in the decomposed outline", async () => {
    // Samples at wght 100 (ring 100 wide, scale 1) and 250 (ring 250 wide,
    // scale 1.25), two thirds of the way: 150 + (362.5 - 150) * 2 / 3.
    const ringbig = await boundsAt("ringbig", 200);

    expect(ringbig.max.x).toBeCloseTo(291.667, 2);
    expect(ringbig.max.y).toBeCloseTo(241.667, 2);
  });

  it("pairs points as the compiler does when one master mirrors its component", async () => {
    expect(await boundsAt("wedgeflip", 400)).toEqual({
      min: { x: 150, y: 0 },
      max: { x: 300, y: 150 },
    });
  });

  // A nested composite drawn before its middle component draws nothing, so
  // these draw `wedgeflip` first.
  async function nestedAt(weight: number): Promise<Bounds> {
    await drawnAt("wedgeflip", weight);
    return boundsAt("wedgenest", weight);
  }

  it("pairs points as the compiler does when nested mirrors cancel", async () => {
    // Light places the wedge at (50,0) (150,0) (50,200); Bold mirrors it
    // twice, to (50,0) (250,0) (50,300) in order. Reversing it once would
    // pair (250,0) with (50,200) and stop at x 150.
    expectBounds(await nestedAt(400), [50, 0, 200, 250]);
  });

  it("draws each master of a nested component exactly as authored", async () => {
    expectBounds(await nestedAt(100), [50, 0, 150, 200]);
    expectBounds(await nestedAt(700), [50, 0, 250, 300]);
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

    expect((await boundsAt("bullet", 400)).max).toEqual({ x: 550, y: 450 });
  });

  it("keeps the occurrence a component of its base glyph between masters", async () => {
    const bullet = await drawnAt("bullet", 400);

    expect(bullet.components.map(({ glyph }) => glyph)).toEqual(["period"]);
    expect(bullet.components[0]!.bounds).toEqual(bullet.bounds);
  });

  it("draws a master exactly as authored", async () => {
    expect(await boundsAt("bullet", 700)).toEqual({
      min: { x: 50, y: 100 },
      max: { x: 650, y: 700 },
    });
  });
});
