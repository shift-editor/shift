import { describe, expect, it } from "vitest";
import type { Font } from "../Font";
import { TextRunManager } from "./TextRunManager";

const font: Font = {
  getMetrics: () => ({
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    xHeight: 500,
    lineGap: 0,
    italicAngle: null,
    underlinePosition: null,
    underlineThickness: null,
  }),
  getMetadata: () => ({
    familyName: "Test",
    styleName: null,
    versionMajor: 1,
    versionMinor: 0,
    copyright: null,
    trademark: null,
    designer: null,
    designerUrl: null,
    manufacturer: null,
    manufacturerUrl: null,
    license: null,
    licenseUrl: null,
    description: null,
    note: null,
  }),
  getSvgPath: () => null,
  getAdvance: () => 500,
  getBbox: () => null,
};

describe("TextRunManager", () => {
  it("keeps text runs isolated per owner glyph", () => {
    const manager = new TextRunManager();
    const glyphA = { glyphName: "A", unicode: 65 } as const;
    const glyphB = { glyphName: "B", unicode: 66 } as const;

    manager.setOwnerGlyph(glyphA);
    manager.ensureSeeded(glyphA);
    manager.buffer.insert(glyphB);
    manager.recompute(font, 10);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([65, 66]);

    manager.setOwnerGlyph(glyphB);
    manager.ensureSeeded(glyphB);
    manager.recompute(font, 30);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([66]);

    manager.setOwnerGlyph(glyphA);
    manager.recompute(font);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([65, 66]);

    expect(Object.keys(manager.exportRuns()).sort()).toEqual(["A", "B"]);
  });

  it("hydrates run map and resolves state from current owner glyph", () => {
    const manager = new TextRunManager();
    const glyphB = { glyphName: "B", unicode: 66 } as const;
    const glyphA = { glyphName: "A", unicode: 65 } as const;
    const glyphC = { glyphName: "C", unicode: 67 } as const;

    manager.setOwnerGlyph(glyphB);
    manager.hydrateRuns({
      A: {
        glyphs: [glyphA],
        cursorPosition: 1,
        originX: 10,
        editingIndex: null,
        editingGlyph: null,
      },
      B: {
        glyphs: [glyphB, glyphC],
        cursorPosition: 2,
        originX: 20,
        editingIndex: null,
        editingGlyph: null,
      },
    });
    manager.recompute(font);

    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([66, 67]);
  });
});
