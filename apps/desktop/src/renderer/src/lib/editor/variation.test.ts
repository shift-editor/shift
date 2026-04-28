import { describe, expect, it } from "vitest";
import type { AxisLocation } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import { TestEditor, MUTATORSANS_DESIGNSPACE } from "@/testing";

function boldLocation(editor: TestEditor): AxisLocation {
  const out: AxisLocation = {};
  for (const axis of editor.font.getAxes()) out[axis.tag] = axis.maximum;
  return out;
}

function flattenPoints(g: Glyph): number[] {
  const out: number[] = [];
  for (const c of g.contours) for (const p of c.points) out.push(p.x, p.y);
  return out;
}

describe("Editor.open — variation-aware edit sessions", () => {
  it("opens a glyph with values interpolated at the current variation location", () => {
    // Regression for 1c2c575: opening a glyph from the grid used to start an
    // edit session at the master's stored coordinates, so the canvas didn't
    // match what the user clicked when the slider was off-default.
    const editor = new TestEditor();
    editor.font.load(MUTATORSANS_DESIGNSPACE);

    const atDefault = editor.open("A")!;
    const defaultAdvance = atDefault.xAdvance;
    const defaultPoints = flattenPoints(atDefault);
    editor.close();

    editor.font.setVariationLocation(boldLocation(editor));
    const atBold = editor.open("A")!;

    expect(atBold.xAdvance).not.toBe(defaultAdvance);
    expect(flattenPoints(atBold)).not.toEqual(defaultPoints);
  });
});
