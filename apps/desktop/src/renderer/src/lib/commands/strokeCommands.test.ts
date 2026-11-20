import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { OutlineContour } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";
import {
  applyDynamicStroke,
  expandStroke,
  expandStrokeWithStyle,
  offsetSelectedContour,
  removeDynamicStroke,
  resolveStrokeSelection,
} from "./strokeCommands";

const ROUND_20: OutlineStrokeStyle = { width: 20, cap: "round", join: "round", miterLimit: 4 };
const ROUND_60: OutlineStrokeStyle = { ...ROUND_20, width: 60 };

/** Draws one open two-point contour with the Pen and leaves the Select tool active. */
async function drawLine(
  editor: EditorTestSurface,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  editor.selectTool("pen");
  await editor.clickAt(from);
  await editor.clickAt(to);
  await editor.pressKey("Escape");
  editor.selectTool("select");
}

/**
 * Draws one closed triangle with the Pen and leaves the Select tool active.
 * `originY` keeps it clear of other contours, whose endpoints the Pen would continue.
 */
async function drawTriangle(editor: EditorTestSurface, originY = 100): Promise<void> {
  editor.selectTool("pen");
  for (const point of [
    { x: 100, y: originY },
    { x: 400, y: originY },
    { x: 400, y: originY + 300 },
    { x: 100, y: originY },
  ]) {
    await editor.clickAt(point);
  }
  await editor.pressKey("Escape");
  editor.selectTool("select");
}

/** The selection a user makes by clicking one point of each contour. */
function selectContours(editor: EditorTestSurface, contours: readonly OutlineContour[]): void {
  editor.select(contours.map((contour) => contour.points[0]!.id as PointId));
}

async function contours(editor: EditorTestSurface): Promise<readonly OutlineContour[]> {
  return editor.outline();
}

/** The y extent of every point in `contours`: a stroke along y = const is as tall as it is wide. */
function heightOf(outline: readonly OutlineContour[]): number {
  const ys = outline.flatMap((contour) => contour.points.map((point) => point.y));

  return Math.max(...ys) - Math.min(...ys);
}

describe("apply dynamic stroke", () => {
  const editor = useTestEditor();

  it("makes the contour a dynamic stroke, keeps it editable, and undoes in one step", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);

    const result = applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();

    expect(result).toEqual({ ok: true });
    expect(editor.dynamicStrokeContours()).toEqual([line!.id]);
    expect(editor.strokeOutlinePreviews()).toHaveLength(1);
    expect(await contours(editor)).toEqual([line]);

    await editor.undo();

    expect(editor.dynamicStrokeContours()).toEqual([]);
  });

  it("replaces the style of a contour that is already dynamic", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();

    applyDynamicStroke(editor.asEditor(), ROUND_60);
    await editor.settle();

    const [preview] = editor.strokeOutlinePreviews();
    expect(preview!.height).toBeGreaterThan(55);
  });

  it("refuses without a selected contour and changes nothing", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const before = await contours(editor);
    editor.select([]);

    const result = applyDynamicStroke(editor.asEditor(), ROUND_20);

    expect(result).toEqual({ ok: false, reason: "Select a contour first." });
    expect(await contours(editor)).toEqual(before);
  });
});

describe("expand stroke", () => {
  const editor = useTestEditor();

  it("bakes a dynamic stroke to closed fills with its stored width, in one undo step", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_60);
    await editor.settle();

    const result = expandStroke(editor.asEditor());
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const baked = await contours(editor);
    expect(baked.every((contour) => contour.closed)).toBe(true);
    expect(baked.map((contour) => contour.id)).not.toContain(line!.id);
    expect(heightOf(baked)).toBeCloseTo(60, 0);
    expect(editor.dynamicStrokeContours()).toEqual([]);

    await editor.undo();

    expect(await contours(editor)).toEqual([line]);
    expect(editor.dynamicStrokeContours()).toEqual([line!.id]);
  });

  it("bakes only the dynamic contours of a mixed selection", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    await drawLine(editor, { x: 100, y: 300 }, { x: 400, y: 300 });
    const [dynamic, plain] = await contours(editor);
    selectContours(editor, [dynamic!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();
    selectContours(editor, [dynamic!, plain!]);

    const result = expandStroke(editor.asEditor());
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const after = await contours(editor);
    expect(after.find((contour) => contour.id === plain!.id)).toEqual(plain);
    expect(after.find((contour) => contour.id === dynamic!.id)).toBeUndefined();
  });

  it("refuses a selection with no dynamic stroke, with the reason, and changes nothing", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const before = await contours(editor);
    selectContours(editor, before);

    const result = expandStroke(editor.asEditor());
    await editor.settle();

    expect(result).toEqual({
      ok: false,
      reason: "None of the selected contours has a dynamic stroke.",
    });
    expect(await contours(editor)).toEqual(before);
  });
});

describe("expand stroke with a style", () => {
  const editor = useTestEditor();

  it("keep editable on: makes a plain contour dynamic", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);

    const result = expandStrokeWithStyle(editor.asEditor(), {
      style: ROUND_20,
      keepEditable: true,
    });
    await editor.settle();

    expect(result).toEqual({ ok: true });
    expect(editor.dynamicStrokeContours()).toEqual([line!.id]);
  });

  it("keep editable on: overwrites the stored style of a dynamic contour", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();

    expandStrokeWithStyle(editor.asEditor(), { style: ROUND_60, keepEditable: true });
    await editor.settle();

    const [preview] = editor.strokeOutlinePreviews();
    expect(preview!.height).toBeGreaterThan(55);
  });

  it("keep editable off, plain contour: outlines it in place with no dynamic stroke left", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);

    const result = expandStrokeWithStyle(editor.asEditor(), {
      style: ROUND_60,
      keepEditable: false,
    });
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const outlined = await contours(editor);
    expect(outlined.every((contour) => contour.closed)).toBe(true);
    expect(heightOf(outlined)).toBeCloseTo(60, 0);
    expect(editor.dynamicStrokeContours()).toEqual([]);

    await editor.undo();

    expect(await contours(editor)).toEqual([line]);
  });

  it("keep editable off, dynamic contour with edited fields: bakes at the new width in one undo step", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();

    const result = expandStrokeWithStyle(editor.asEditor(), {
      style: ROUND_60,
      keepEditable: false,
    });
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const baked = await contours(editor);
    expect(heightOf(baked)).toBeCloseTo(60, 0);
    expect(editor.dynamicStrokeContours()).toEqual([]);

    await editor.undo();

    expect(await contours(editor)).toEqual([line]);
    const [preview] = editor.strokeOutlinePreviews();
    expect(preview!.height).toBeLessThan(25);
  });

  it("keep editable off, mixed selection: bakes the dynamic contour and outlines the plain one", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    await drawLine(editor, { x: 100, y: 300 }, { x: 400, y: 300 });
    const [dynamic, plain] = await contours(editor);
    selectContours(editor, [dynamic!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();
    selectContours(editor, [dynamic!, plain!]);

    const result = expandStrokeWithStyle(editor.asEditor(), {
      style: ROUND_20,
      keepEditable: false,
    });
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const after = await contours(editor);
    expect(after.every((contour) => contour.closed)).toBe(true);
    expect(editor.dynamicStrokeContours()).toEqual([]);
  });

  it("refuses an invalid style with the engine's reason and leaves the document unchanged", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const before = await contours(editor);
    selectContours(editor, before);

    const result = expandStrokeWithStyle(editor.asEditor(), {
      style: { ...ROUND_20, width: 0 },
      keepEditable: false,
    });
    await editor.settle();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Outline stroke failed");
    expect(await contours(editor)).toEqual(before);
  });
});

describe("remove dynamic stroke", () => {
  const editor = useTestEditor();

  it("drops the stroke, keeps the contour, and undoes in one step", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const [line] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();

    const result = removeDynamicStroke(editor.asEditor());
    await editor.settle();

    expect(result).toEqual({ ok: true });
    expect(editor.dynamicStrokeContours()).toEqual([]);
    expect(editor.strokeOutlinePreviews()).toEqual([]);
    expect(await contours(editor)).toEqual([line]);

    await editor.undo();

    expect(editor.dynamicStrokeContours()).toEqual([line!.id]);
  });

  it("acts on the dynamic contours of a mixed selection and leaves the rest", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    await drawLine(editor, { x: 100, y: 300 }, { x: 400, y: 300 });
    const [dynamic, plain] = await contours(editor);
    selectContours(editor, [dynamic!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();
    selectContours(editor, [dynamic!, plain!]);

    const result = removeDynamicStroke(editor.asEditor());
    await editor.settle();

    expect(result).toEqual({ ok: true });
    expect(editor.dynamicStrokeContours()).toEqual([]);
    expect(await contours(editor)).toEqual([dynamic, plain]);
  });

  it("refuses a selection with no dynamic stroke", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    selectContours(editor, await contours(editor));

    expect(removeDynamicStroke(editor.asEditor())).toEqual({
      ok: false,
      reason: "None of the selected contours has a dynamic stroke.",
    });
  });
});

describe("offset contour", () => {
  const editor = useTestEditor();

  it("grows a closed contour and undoes in one step", async () => {
    await drawTriangle(editor);
    const [triangle] = await contours(editor);
    selectContours(editor, [triangle!]);
    const before = heightOf([triangle!]);

    const result = offsetSelectedContour(editor.asEditor(), {
      distance: 20,
      join: "round",
      miterLimit: 4,
    });
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const grown = await contours(editor);
    expect(heightOf(grown)).toBeGreaterThan(before + 30);

    await editor.undo();

    expect(await contours(editor)).toEqual([triangle]);
  });

  it("refuses an open contour with the reason and changes nothing", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    const before = await contours(editor);
    selectContours(editor, before);

    const result = offsetSelectedContour(editor.asEditor(), {
      distance: 20,
      join: "round",
      miterLimit: 4,
    });

    expect(result).toEqual({ ok: false, reason: "Offset needs a closed contour." });
    expect(await contours(editor)).toEqual(before);
  });
});

describe("resolving the selection", () => {
  const editor = useTestEditor();

  it("reports each selected contour once, with whether it is closed and dynamic", async () => {
    await drawLine(editor, { x: 100, y: 100 }, { x: 400, y: 100 });
    await drawTriangle(editor, 500);
    const [line, triangle] = await contours(editor);
    selectContours(editor, [line!]);
    applyDynamicStroke(editor.asEditor(), ROUND_20);
    await editor.settle();
    editor.select([...line!.points, ...triangle!.points].map((point) => point.id as PointId));

    const { selection } = resolveStrokeSelection(editor.asEditor());

    expect(selection.readOnly).toBe(false);
    expect(selection.layer).toEqual({ kind: "editable" });
    expect(selection.contours).toEqual([
      { id: line!.id, closed: false, dynamic: true },
      { id: triangle!.id, closed: true, dynamic: false },
    ]);
  });
});

describe("a font open for preview", () => {
  const editor = useTestEditor({ mode: "preview" });

  it("refuses with the read-only reason", () => {
    const result = applyDynamicStroke(editor.asEditor(), ROUND_20);

    expect(result).toEqual({
      ok: false,
      reason: "This font is open read-only, so strokes cannot be changed.",
    });
  });
});
