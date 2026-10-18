import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import type { Bounds } from "@shift/geo";
import { defaultExternalAxisLocation, withExternalAxisValue } from "@shift/editor/variation";
import { signal } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

// `bullet` places `period` at scale 1 in Light (wght 100) and 3 in Bold
// (wght 700); `bar` mirrors it and doubles its height in Bold. Compiled fonts
// interpolate both decomposed, so halfway they draw the blend of each
// master's placed outline, not the blended transform applied to the blended
// base. `ringbig` scales `ring`, whose intermediate master at wght 250 the
// decomposed glyph keeps. `wedgeflip` mirrors `wedge` in Bold only, so the
// compiler reverses that master's contour. `wedgenest` mirrors `wedgeflip`
// in Bold, so Bold's wedge is mirrored twice and keeps its order. The
// expected bounds are the exported font's.
const SCALED_COMPONENT = resolve(process.cwd(), "../../fixtures/fonts/ScaledComponent.glyphs");

describe("components that change scale between masters interpolate like the compiled font", () => {
  let editor: TestEditor;

  const renderModelAt = async (name: string, weight: number) => {
    const glyph = await editor.font.loadGlyph(editor.font.recordForName(name as GlyphName)!.id);
    const axes = editor.font.getAxes();
    const location = withExternalAxisValue(defaultExternalAxisLocation(axes), axes[0]!, weight);
    return glyph.renderModelAt(signal(location));
  };

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SCALED_COMPONENT, "bullet");
  });

  it("draws a scaled component's outline as the exported font does halfway", async () => {
    const bullet = await renderModelAt("bullet", 400);

    expect(bullet.bounds).toEqual({ min: { x: 50, y: 100 }, max: { x: 400, y: 450 } });
  });

  it("draws a mirrored component's outline as the exported font does halfway", async () => {
    const bar = await renderModelAt("bar", 400);

    expect(bar.bounds).toEqual({ min: { x: 250, y: 0 }, max: { x: 400, y: 250 } });
  });

  it("keeps a component's intermediate master in the decomposed outline", async () => {
    // Samples at wght 100 (ring 100 wide, scale 1) and 250 (ring 250 wide,
    // scale 1.25), two thirds of the way: 150 + (362.5 - 150) * 2 / 3.
    const ringbig = await renderModelAt("ringbig", 200);

    expect(ringbig.bounds!.max.x).toBeCloseTo(291.667, 2);
    expect(ringbig.bounds!.max.y).toBeCloseTo(241.667, 2);
  });

  it("pairs points as the compiler does when one master mirrors its component", async () => {
    const wedgeflip = await renderModelAt("wedgeflip", 400);

    expect(wedgeflip.bounds).toEqual({ min: { x: 150, y: 0 }, max: { x: 300, y: 150 } });
  });

  // A nested composite opened before its middle component draws nothing,
  // also on main, so these load `wedgeflip` first.
  const nestedAt = async (weight: number) => {
    await renderModelAt("wedgeflip", weight);
    return (await renderModelAt("wedgenest", weight)).bounds!;
  };

  const expectBounds = (bounds: Bounds, [minX, minY, maxX, maxY]: number[]) => {
    expect(bounds.min.x).toBeCloseTo(minX!);
    expect(bounds.min.y).toBeCloseTo(minY!);
    expect(bounds.max.x).toBeCloseTo(maxX!);
    expect(bounds.max.y).toBeCloseTo(maxY!);
  };

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

  it("follows a live edit to a component master between masters", async () => {
    const bullet = await renderModelAt("bullet", 400);
    const period = await editor.font.loadGlyph(
      editor.font.recordForName("period" as GlyphName)!.id,
    );
    const bold = editor.font.sources.find((source) => source.name === "Bold")!;
    const boldPeriod = period.layerForSource(bold.id)!;
    const corner = boldPeriod.allPoints.find((point) => point.x === 200 && point.y === 200)!;

    // Bold places period at scale 3 from (50,100): moving its corner to
    // (300,200) moves the placed corner to (950,700); halfway from Light's
    // (150,200) that is (550,450).
    boldPeriod.applyPositionPatch([{ kind: "point", id: corner.id, x: 300, y: 200 }]);

    expect(bullet.bounds!.max).toEqual({ x: 550, y: 450 });
  });

  it("keeps the occurrence a component of its base glyph between masters", async () => {
    const bullet = await renderModelAt("bullet", 400);

    expect(bullet.components.map((component) => component.glyphId)).toEqual([
      editor.font.recordForName("period" as GlyphName)!.id,
    ]);
    expect(bullet.components[0]!.bounds).toEqual(bullet.bounds);
  });

  it("draws a master exactly as authored", async () => {
    const bullet = await renderModelAt("bullet", 700);

    expect(bullet.bounds).toEqual({ min: { x: 50, y: 100 }, max: { x: 650, y: 700 } });
  });
});
