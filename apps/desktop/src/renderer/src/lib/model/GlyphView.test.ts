import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effect } from "@/lib/reactive";
import { Font } from "./Font";
import { createBridge } from "@/testing/engine";

const FIXTURE = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

function loadMutatorSans(): Font {
  const font = new Font(createBridge());
  font.load(FIXTURE);
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
});
