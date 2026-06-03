import { describe, expect, it } from "vitest";
import type { Glyph, GlyphGeometry } from "@/lib/model/Glyph";
import { TestEditor, MUTATORSANS_DESIGNSPACE, testStorePath } from "@/testing";
import { emptyAxisLocation, withAxisValue } from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";

function boldLocation(editor: TestEditor): AxisLocation {
  let out = emptyAxisLocation();
  for (const axis of editor.font.getAxes()) {
    out = withAxisValue(out, axis, axis.maximum);
  }
  return out;
}

function flattenPoints(g: Glyph | GlyphGeometry): number[] {
  const out: number[] = [];
  for (const c of g.contours) for (const p of c.points) out.push(p.x, p.y);
  return out;
}

describe("Editor.open — variation-aware glyph reads", () => {
  it("opens a glyph with values interpolated at the current variation location", () => {
    // Regression for 1c2c575: opening a glyph from the grid used to read the
    // master's stored coordinates, so the canvas didn't
    // match what the user clicked when the slider was off-default.
    const editor = new TestEditor();
    editor.loadFont(MUTATORSANS_DESIGNSPACE, testStorePath("default"));

    const atDefault = editor.getGlyph({ name: "A", unicode: 65 })!;
    const defaultGeometry = atDefault.geometryAt(editor.designLocation);
    const defaultAdvance = defaultGeometry.xAdvance;
    const defaultPoints = flattenPoints(defaultGeometry);
    editor.close();

    editor.setDesignLocation(boldLocation(editor));
    const atBold = editor.getGlyph({ name: "A", unicode: 65 })!;

    const boldGeometry = atBold.geometryAt(editor.designLocation);
    expect(boldGeometry.xAdvance).not.toBe(defaultAdvance);
    expect(flattenPoints(boldGeometry)).not.toEqual(defaultPoints);
  });

  it("edits to a glyph persist across close + reopen of that same glyph", () => {
    // Reproduces the user-reported flow: edit a point, leave the editor (back
    // to the grid), then re-open the same glyph. The re-opened glyph should
    // carry the edit, not revert to the unedited geometry.
    const editor = new TestEditor();
    editor.loadFont(MUTATORSANS_DESIGNSPACE, testStorePath("persist"));

    const opened = editor.getGlyph({ name: "A", unicode: 65 })!;
    const point = opened.contours[0].points[0];
    const movedX = point.x + 250;

    const draft = editor.beginSourceEditDraft({ points: [point.id] });
    draft.previewPositionPatch([{ kind: "point", id: point.id, x: movedX, y: point.y }]);
    draft.commit("Move");

    editor.close();

    const reopened = editor.getGlyph({ name: "A", unicode: 65 })!;
    const samePoint = reopened.point(point.id);

    expect(samePoint?.x).toBe(movedX);
  });

  it("edits to a glyph are visible from the registry after closing the glyph", () => {
    // The grid renders via `font.glyph(name)` (not the editor), so after the
    // glyph closes, the registry's Glyph must reflect the edits the user
    // just made. Otherwise the grid shows the pre-edit outline.
    const editor = new TestEditor();
    editor.loadFont(MUTATORSANS_DESIGNSPACE, testStorePath("registry"));

    const opened = editor.getGlyph({ name: "A", unicode: 65 })!;
    const point = opened.contours[0].points[0];
    const movedX = point.x + 250;

    const draft = editor.beginSourceEditDraft({ points: [point.id] });
    draft.previewPositionPatch([{ kind: "point", id: point.id, x: movedX, y: point.y }]);
    draft.commit("Move");

    editor.close();

    // Same Glyph instance the grid would read — registry single-source-of-truth.
    const fromRegistry = editor.font.glyph({ name: "A" })!;
    expect(fromRegistry.outline(editor.$designLocation).svgPath).toContain(String(movedX));
  });
});
