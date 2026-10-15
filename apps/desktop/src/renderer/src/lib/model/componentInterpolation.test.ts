import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { defaultExternalAxisLocation, withExternalAxisValue } from "@shift/editor/variation";
import { signal } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

// `bullet` places `period` at scale 1 in Light (wght 100) and 3 in Bold
// (wght 700); `bar` mirrors it and doubles its height in Bold. Compiled fonts
// interpolate both decomposed, so halfway they draw the blend of each
// master's placed outline, not the blended transform applied to the blended
// base. `ringbig` scales `ring`, whose intermediate master at wght 250 the
// decomposed glyph keeps. `wedgeflip` mirrors `wedge` in Bold only, so the
// compiler reverses that master's contour. The expected bounds are the
// exported font's.
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
