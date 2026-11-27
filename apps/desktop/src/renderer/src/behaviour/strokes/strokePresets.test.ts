import { beforeEach, describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import {
  applyStrokePreset,
  copiedStrokeStyleCell,
  copyStrokeStyle,
  deleteStrokePreset,
  pasteStrokeStyle,
  renameStrokePreset,
  saveAsStrokePreset,
} from "@/lib/commands/strokePresetCommands";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const FLAT_30: OutlineStrokeStyle = {
  width: 30,
  cap: "butt",
  join: "miter",
  miterLimit: 4,
  position: 0,
};

const ROUND_20: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

describe("stroke presets", () => {
  const editor = useTestEditor({
    glyphs: {
      A: { outline: { advance: 500, contours: [rect(50, 50, 200, 200)] } },
    },
  });

  async function selectFirstContour(): Promise<void> {
    const [contour] = await editor.outline();
    editor.select([contour!.points[0]!.id as PointId]);
  }

  it("starts with no presets", () => {
    expect(editor.strokePresets()).toHaveLength(0);
  });

  it("saves a new named preset and returns its id", () => {
    const result = saveAsStrokePreset(editor.asEditor(), "Flat 30", FLAT_30);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(editor.strokePresets()).toHaveLength(1);
    expect(editor.strokePreset({ id: result.presetId })).toMatchObject({
      name: "Flat 30",
      style: { width: 30 },
    });
  });

  it("refuses a blank preset name", () => {
    const result = saveAsStrokePreset(editor.asEditor(), "  ", FLAT_30);

    expect(result).toEqual({ ok: false, reason: "Preset name must not be blank." });
  });

  it("renames a preset", () => {
    const saved = saveAsStrokePreset(editor.asEditor(), "Old name", ROUND_20);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const renamed = renameStrokePreset(editor.asEditor(), saved.presetId, "New name");
    expect(renamed.ok).toBe(true);

    expect(editor.strokePreset({ id: saved.presetId })).toMatchObject({ name: "New name" });
  });

  it("refuses renaming with a blank name", () => {
    const saved = saveAsStrokePreset(editor.asEditor(), "Round 20", ROUND_20);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = renameStrokePreset(editor.asEditor(), saved.presetId, "");
    expect(result).toEqual({ ok: false, reason: "Preset name must not be blank." });
  });

  it("deletes a preset", () => {
    const saved = saveAsStrokePreset(editor.asEditor(), "To delete", FLAT_30);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const before = editor.strokePresets().length;
    const deleted = deleteStrokePreset(editor.asEditor(), saved.presetId);
    expect(deleted.ok).toBe(true);

    expect(editor.strokePresets().length).toBe(before - 1);
    expect(editor.strokePreset({ id: saved.presetId })).toBeUndefined();
  });

  it("refuses deleting an unknown preset id", () => {
    const result = deleteStrokePreset(editor.asEditor(), "preset_nonexistent");
    expect(result.ok).toBe(false);
  });

  it("applies a preset to selected contours and uses the preset's style", async () => {
    await selectFirstContour();
    expect(applyDynamicStroke(editor.asEditor(), FLAT_30)).toEqual({ ok: true });
    await editor.settle();

    const saved = saveAsStrokePreset(editor.asEditor(), "Apply me", ROUND_20);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    await editor.settle();
    await selectFirstContour();
    const applied = applyStrokePreset(editor.asEditor(), saved.presetId);
    expect(applied.ok).toBe(true);

    await editor.settle();
    const [stroke] = editor.strokeStyles();
    expect(stroke?.style.width).toBe(20);
  });

  it("refuses applying a preset when no contours are selected", () => {
    editor.select([]);
    const saved = saveAsStrokePreset(editor.asEditor(), "No sel", FLAT_30);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = applyStrokePreset(editor.asEditor(), saved.presetId);
    expect(result.ok).toBe(false);
  });

  it("refuses applying an unknown preset id", async () => {
    await selectFirstContour();
    const result = applyStrokePreset(editor.asEditor(), "preset_unknown");
    expect(result.ok).toBe(false);
  });
});

describe("copy / paste stroke style", () => {
  const editor = useTestEditor({
    glyphs: {
      A: { outline: { advance: 500, contours: [rect(50, 50, 200, 200)] } },
    },
  });

  async function selectFirstContour(): Promise<void> {
    const [contour] = await editor.outline();
    editor.select([contour!.points[0]!.id as PointId]);
  }

  beforeEach(() => {
    copiedStrokeStyleCell.set(null);
  });

  it("copies the stroke style of the selected stroked contour", async () => {
    await selectFirstContour();
    expect(applyDynamicStroke(editor.asEditor(), FLAT_30)).toEqual({ ok: true });
    await editor.settle();

    await selectFirstContour();
    const result = copyStrokeStyle(editor.asEditor());
    expect(result.ok).toBe(true);
    expect(copiedStrokeStyleCell.peek()).toMatchObject({ width: 30 });
  });

  it("refuses to copy when no contour is selected", () => {
    editor.select([]);
    const result = copyStrokeStyle(editor.asEditor());
    expect(result.ok).toBe(false);
  });

  it("refuses to copy when selected contour has no dynamic stroke", async () => {
    await selectFirstContour();
    const result = copyStrokeStyle(editor.asEditor());
    expect(result.ok).toBe(false);
  });

  it("pastes a copied stroke style onto a contour with a different stroke", async () => {
    // Save a preset for the second style so we can swap the stroke without applyDynamicStroke.
    const roundPreset = saveAsStrokePreset(editor.asEditor(), "Round 20", ROUND_20);
    expect(roundPreset.ok).toBe(true);
    if (!roundPreset.ok) return;
    await editor.settle();

    // Apply FLAT_30 and copy it.
    await selectFirstContour();
    expect(applyDynamicStroke(editor.asEditor(), FLAT_30)).toEqual({ ok: true });
    await editor.settle();

    await selectFirstContour();
    expect(copyStrokeStyle(editor.asEditor()).ok).toBe(true);

    // Swap to ROUND_20 via preset (applyStrokePreset updates an existing stroke).
    await selectFirstContour();
    expect(applyStrokePreset(editor.asEditor(), roundPreset.presetId).ok).toBe(true);
    await editor.settle();

    // Paste restores FLAT_30.
    await selectFirstContour();
    const result = pasteStrokeStyle(editor.asEditor());
    expect(result.ok).toBe(true);

    await editor.settle();
    const [stroke] = editor.strokeStyles();
    expect(stroke?.style.width).toBe(30);
  });

  it("refuses to paste when nothing has been copied", async () => {
    await selectFirstContour();
    const result = pasteStrokeStyle(editor.asEditor());
    expect(result.ok).toBe(false);
  });
});
