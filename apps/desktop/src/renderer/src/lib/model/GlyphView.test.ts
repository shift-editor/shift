import { describe, expect, it } from "vitest";
import { effect } from "@/lib/reactive";
import { Font } from "./Font";
import { createBridge, MUTATORSANS_DESIGNSPACE } from "@/testing";

function loadMutatorSans(): Font {
  const font = new Font(createBridge());
  font.load(MUTATORSANS_DESIGNSPACE);
  return font;
}

function locationOverride(font: Font, override: Record<string, number>) {
  const out = { ...override };
  for (const axis of font.getAxes()) {
    if (out[axis.tag] === undefined) out[axis.tag] = axis.default;
  }
  return out;
}

describe("GlyphView — variation interpolation", () => {
  it("composite glyph svgPath changes when the variation location moves", () => {
    const font = loadMutatorSans();
    // Aacute = A + acute (pure composite in MutatorSans).
    const aacute = font.glyph("Aacute");
    expect(aacute).not.toBeNull();

    let lastSvg = "";
    const sub = effect(() => {
      lastSvg = aacute!.$svgPath.value;
    });

    const atDefault = lastSvg;
    expect(atDefault.length).toBeGreaterThan(0);

    const axes = font.getAxes();
    const bold = locationOverride(font, Object.fromEntries(axes.map((a) => [a.tag, a.maximum])));
    font.setVariationLocation(bold);

    expect(lastSvg).not.toBe(atDefault);

    sub.dispose();
  });

  it("non-composite glyph also interpolates", () => {
    const font = loadMutatorSans();
    const a = font.glyph("A");
    expect(a).not.toBeNull();

    let lastSvg = "";
    const sub = effect(() => {
      lastSvg = a!.$svgPath.value;
    });

    const atDefault = lastSvg;
    const axes = font.getAxes();
    const bold = locationOverride(font, Object.fromEntries(axes.map((a) => [a.tag, a.maximum])));
    font.setVariationLocation(bold);

    expect(lastSvg).not.toBe(atDefault);

    sub.dispose();
  });

  it("componentContours yields interpolated blocks (covers canvas component drawing)", () => {
    // The canvas's renderToolScene reads view.componentContours() directly
    // when drawing components of an active composite edit. This ensures the
    // iterator yields different geometry across variation locations — i.e.
    // composites in the canvas will redraw on slider scrub.
    const font = loadMutatorSans();
    const aacute = font.glyph("Aacute")!;

    const firstX = (): number => {
      for (const block of aacute.componentContours()) {
        if (block.segments.length > 0) return block.segments[0].points[0];
      }
      return NaN;
    };

    const xAtDefault = firstX();
    expect(Number.isFinite(xAtDefault)).toBe(true);

    const axes = font.getAxes();
    const bold = locationOverride(font, Object.fromEntries(axes.map((a) => [a.tag, a.maximum])));
    font.setVariationLocation(bold);

    expect(firstX()).not.toBe(xAtDefault);
  });

  it("rootContours of a pure composite is empty", () => {
    const font = loadMutatorSans();
    const aacute = font.glyph("Aacute")!;
    const blocks = [...aacute.rootContours()];
    expect(blocks).toEqual([]);
  });
});
