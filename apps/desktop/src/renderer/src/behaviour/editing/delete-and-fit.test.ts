import { describe, expect, it } from "vitest";
import { Curve, Vec2 } from "@shift/geo";
import { expectEdit } from "@/testing/expectEdit";
import { splitCubic } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();

/** The curve the split fixtures draw: from 0,0 to 200,0, pulled up by controls at 50,100 and 200,100. */
const ORIGINAL = [
  { x: 0, y: 0 },
  { x: 50, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 0 },
] as const;

describe("deleting an on-curve point fits a curve across its span", () => {
  it("recovers a split cubic and keeps its endpoints", async () => {
    const names = await editor.draw({ contours: [splitCubic(...ORIGINAL, 0.4)] });

    await expectEdit(
      editor,
      async (e) => {
        e.select([names.p1]);
        expect(await e.deleteSelection()).toBe(true);
      },
      async (e) => {
        const points = (await e.outline())[0]!.points;
        expect(points).toMatchObject([
          { pointType: "onCurve", id: names.p0 },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve", id: names.p2 },
        ]);
        // The furthest any of 40 samples along the original lies from the same parameter on the fit.
        const fit = Curve.cubic(points[0]!, points[1]!, points[2]!, points[3]!);
        const distances = Curve.sample(Curve.cubic(...ORIGINAL), 40).map((point, index) =>
          Vec2.dist(point, Curve.pointAt(fit, index / 40)),
        );
        expect(Math.max(...distances)).toBeLessThan(0.1);
        expect(e.selectionIds()).toEqual([]);
      },
    );
  });

  it("fits the same curve when the point's handles are selected with it", async () => {
    const names = await editor.draw({ contours: [splitCubic(...ORIGINAL, 0.4)] });
    editor.select([names.p1]);
    await editor.deleteSelection();
    const fitted = await editor.outline();
    await editor.undo();

    editor.select([names.c0a, names.p1]);
    await editor.deleteSelection();

    expect(await editor.outline()).toDrawLike(fitted);
  });

  it("fits adjacent selected points once, whatever order they were selected in", async () => {
    const names = await editor.draw({ contours: [splitCubic(...ORIGINAL, 0.3, 0.6)] });
    editor.select([names.p1, names.p2]);
    await editor.deleteSelection();
    const fitted = await editor.outline();
    await editor.undo();

    editor.select([names.p2, names.p1]);
    await editor.deleteSelection();

    expect(fitted).toMatchObject([{ points: Array(4).fill({}) }]);
    expect(await editor.outline()).toDrawLike(fitted);
  });

  it("treats a clicked segment like all of its points selected", async () => {
    const contour = splitCubic(...ORIGINAL, 0.25, 0.65);
    const names = await editor.draw({ contours: [contour] });
    const [, , , p1, c1a, c1b, p2] = contour.points;
    editor.select([names.p1, names.c1a, names.c1b, names.p2]);
    await editor.deleteSelection();
    const fitted = await editor.outline();
    await editor.undo();

    await editor.clickAt(Curve.pointAt(Curve.cubic(p1!, c1a!, c1b!, p2!), 0.5));
    await editor.deleteSelection();

    expect(await editor.outline()).toDrawLike(fitted);
  });

  it("leaves the two endpoints apart when a gap removes the only two segments", async () => {
    const names = await editor.draw({ contours: [splitCubic(...ORIGINAL, 0.4)] });
    editor.select([names.p1]);

    await editor.deleteSelection("gap");

    expect(await editor.outline()).toMatchObject([
      { closed: false, points: [{ id: names.p0, pointType: "onCurve" }] },
      { closed: false, points: [{ id: names.p2, pointType: "onCurve" }] },
    ]);
  });

  it("does not delete while an interpolated location is shown", async () => {
    await editor.draw({ contours: [splitCubic(...ORIGINAL)] });
    const before = await editor.outline();
    await editor.addAxis(WEIGHT);
    editor.selectAll();
    editor.setLocation({ wght: 550 });

    expect(editor.editorView().activeSourceId).toBeNull();
    expect(await editor.deleteSelection()).toBe(false);

    editor.clickSource("Regular");
    expect(await editor.outline()).toEqual(before);
  });
});

describe("deleting a point never raises the degree of the span it joins", () => {
  it.each([0, 100])("joins two lines across a corner at y=%s into a line", async (y) => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y, name: "b" },
            { x: 200, y: 0, name: "c" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([b]);
        await e.deleteSelection();
      },
      async (e) => {
        expect(await e.outline()).toEqual([
          expect.objectContaining({
            points: [
              { id: a, x: 0, y: 0, pointType: "onCurve", smooth: false },
              { id: c, x: 200, y: 0, pointType: "onCurve", smooth: false },
            ],
          }),
        ]);
      },
    );
  });

  it("keeps an untouched cubic while joining the line-only span beside it", async () => {
    const { b } = await editor.draw({
      contours: [
        {
          points: [
            [0, 0],
            { x: 100, y: 100, name: "b" },
            [200, 0],
            { x: 233, y: 0, off: true },
            { x: 267, y: 0, off: true },
            [300, 0],
          ],
        },
      ],
    });
    const untouched = (await editor.outline())[0]!.points.slice(2);
    editor.select([b]);

    await editor.deleteSelection();

    expect(await editor.outline()).toMatchObject([
      { points: [{ pointType: "onCurve" }, ...untouched] },
    ]);
  });

  it("still fits a cubic when the removed span mixes a line and a cubic", async () => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y: 100, name: "b" },
            { x: 133, y: 67, off: true },
            { x: 167, y: 33, off: true },
            { x: 200, y: 0, name: "c" },
          ],
        },
      ],
    });
    editor.select([b]);

    await editor.deleteSelection();

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { id: a, pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { id: c, pointType: "onCurve" },
        ],
      },
    ]);
  });

  it.each([
    {
      joined: "line",
      after: [],
      result: ["onCurve", "offCurve", "qCurve"],
    },
    {
      joined: "quad",
      after: [{ x: 150, y: 100, off: true as const }],
      result: ["onCurve", "offCurve", "qCurve"],
    },
    {
      joined: "cubic",
      after: [
        { x: 133, y: 67, off: true as const },
        { x: 167, y: 33, off: true as const },
      ],
      result: ["onCurve", "offCurve", "offCurve", "qCurve"],
    },
  ])("keeps the higher degree when joining a quadratic to a $joined", async ({ after, result }) => {
    const { start, joint, end } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "start" },
            { x: 50, y: 100, off: true },
            { x: 100, y: 100, qCurve: true, name: "joint" },
            ...after,
            { x: 200, y: 0, qCurve: true, name: "end" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([joint]);
        await e.deleteSelection();
      },
      async (e) => {
        const controls = result.slice(1, -1).map((pointType) => ({ pointType }));
        expect(await e.outline()).toMatchObject([
          {
            points: [
              { pointType: "onCurve", id: start },
              ...controls,
              { pointType: "qCurve", id: end },
            ],
          },
        ]);
      },
    );
  });
});
