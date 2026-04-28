import { describe, expect, it } from "vitest";
import { effect } from "@/lib/reactive";
import { Font } from "./Font";
import { TestEditor, createBridge, MUTATORSANS_DESIGNSPACE } from "@/testing";
import type { GlyphView } from "./GlyphView";

function loadMutatorSans(): Font {
  const font = new Font(createBridge());
  font.load(MUTATORSANS_DESIGNSPACE);
  return font;
}

function flattenComponentCoords(view: GlyphView): number[] {
  const out: number[] = [];
  for (const block of view.componentContours()) {
    for (const seg of block.segments) out.push(...seg.points);
  }
  return out;
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

    const atDefault = flattenComponentCoords(aacute);
    expect(atDefault.length).toBeGreaterThan(0);

    const axes = font.getAxes();
    const bold = locationOverride(font, Object.fromEntries(axes.map((a) => [a.tag, a.maximum])));
    font.setVariationLocation(bold);

    const atBold = flattenComponentCoords(aacute);
    expect(atBold).toHaveLength(atDefault.length);
    expect(atBold).not.toEqual(atDefault);
  });

  it("editor.applyVariation re-interpolates a pure composite's component blocks", () => {
    // Regression for the bug fixed in 22aa095 ("canvas interpolates composite
    // components on slider scrub"). Pure composites have no own variationData
    // so applyVariation's per-glyph interpolation no-ops — the slider must
    // still flow through font.$variationLocation so the canvas redraw path
    // (font.glyph(name).componentContours()) picks up new component geometry.
    const editor = new TestEditor();
    editor.font.load(MUTATORSANS_DESIGNSPACE);
    editor.open("Aacute");

    const view = editor.font.glyph("Aacute")!;
    const atDefault = flattenComponentCoords(view);
    expect(atDefault.length).toBeGreaterThan(0);

    const axes = editor.font.getAxes();
    const bold = locationOverride(
      editor.font,
      Object.fromEntries(axes.map((a) => [a.tag, a.maximum])),
    );
    editor.applyVariation(bold);

    const atBold = flattenComponentCoords(view);
    expect(atBold).not.toEqual(atDefault);
  });

  it("rootContours of a pure composite is empty", () => {
    const font = loadMutatorSans();
    const aacute = font.glyph("Aacute")!;
    const blocks = [...aacute.rootContours()];
    expect(blocks).toEqual([]);
  });
});
