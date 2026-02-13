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

    manager.setOwnerGlyph(65);
    manager.ensureSeeded(65);
    manager.buffer.insert(66);
    manager.recompute(font, 10);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([65, 66]);

    manager.setOwnerGlyph(66);
    manager.ensureSeeded(66);
    manager.recompute(font, 30);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([66]);

    manager.setOwnerGlyph(65);
    manager.recompute(font);
    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([65, 66]);

    expect(Object.keys(manager.exportRuns()).sort()).toEqual(["65", "66"]);
  });

  it("hydrates run map and resolves state from current owner glyph", () => {
    const manager = new TextRunManager();

    manager.setOwnerGlyph(66);
    manager.hydrateRuns({
      "65": {
        codepoints: [65],
        cursorPosition: 1,
        originX: 10,
        editingIndex: null,
        editingUnicode: null,
      },
      "66": {
        codepoints: [66, 67],
        cursorPosition: 2,
        originX: 20,
        editingIndex: null,
        editingUnicode: null,
      },
    });
    manager.recompute(font);

    expect(manager.state.peek()?.layout.slots.map((slot) => slot.unicode)).toEqual([66, 67]);
  });
});
