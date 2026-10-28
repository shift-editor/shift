import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

/** An open cubic from `a` to `b`, then a second cubic from `b` to `c`. */
const TWO_CUBICS = {
  contours: [
    {
      points: [
        { x: 0, y: 0, name: "a" },
        { x: 50, y: 100, off: true, name: "aOut" },
        { x: 200, y: 100, off: true, name: "bIn" },
        { x: 200, y: 0, name: "b" },
        { x: 200, y: -100, off: true, name: "bOut" },
        { x: 400, y: -100, off: true, name: "cIn" },
        { x: 400, y: 0, name: "c" },
      ],
    },
  ],
} as const;

/** A closed pentagon of corners `p0`…`p4`. */
const PENTAGON = [
  { x: 0, y: 0, name: "p0" },
  { x: 100, y: 0, name: "p1" },
  { x: 200, y: 100, name: "p2" },
  { x: 100, y: 200, name: "p3" },
  { x: 0, y: 100, name: "p4" },
] as const;

describe("deleting a cubic's handle turns the segment into a line", () => {
  it.each(["fit", "gap"] as const)("removes both handles in %s mode", async (mode) => {
    const { a, aOut, b } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 50, y: 100, off: true, name: "aOut" },
            { x: 200, y: 100, off: true },
            { x: 200, y: 0, name: "b" },
          ],
        },
      ],
    });
    editor.select([aOut]);

    await editor.deleteSelection(mode);

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { id: a, pointType: "onCurve" },
          { id: b, pointType: "onCurve" },
        ],
      },
    ]);
    expect((await editor.outline())[0]!.points).toHaveLength(2);
  });

  it("removes a segment's handles once when both are selected", async () => {
    const { a, aOut, bIn, b } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 50, y: 100, off: true, name: "aOut" },
            { x: 200, y: 100, off: true, name: "bIn" },
            { x: 200, y: 0, name: "b" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([aOut, bIn]);
        await e.deleteSelection();
      },
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points.map(({ id }) => id)).toEqual([a, b]);
      },
    );
  });

  it("leaves the next segment alone", async () => {
    const { aOut } = await editor.draw(TWO_CUBICS);
    const next = (await editor.outline())[0]!.points.slice(3);
    editor.select([aOut]);

    await editor.deleteSelection();

    expect((await editor.outline())[0]!.points.slice(1)).toEqual(next);
  });
});

describe("deleting handles around a closed contour's start", () => {
  it("fits across controls stored before the start without treating them as an open end", async () => {
    const { p0 } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [{ x: 0, y: 67, off: true }, { x: 0, y: 33, off: true }, ...PENTAGON],
        },
      ],
    });
    editor.select([p0]);

    await editor.deleteSelection();

    const [contour] = await editor.outline();
    expect(contour?.closed).toBe(true);
    expect(contour?.points.map(({ pointType }) => pointType)).toEqual([
      "onCurve",
      "onCurve",
      "onCurve",
      "onCurve",
      "offCurve",
      "offCurve",
    ]);
  });

  it("turns the wrapped cubic into a line when a control stored first is selected", async () => {
    const { first } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            { x: 0, y: 67, off: true, name: "first" },
            { x: 0, y: 33, off: true },
            ...PENTAGON,
          ],
        },
      ],
    });
    editor.select([first]);

    await editor.deleteSelection();

    const [contour] = await editor.outline();
    expect(contour?.closed).toBe(true);
    expect(contour?.points.map(({ pointType }) => pointType)).toEqual(Array(5).fill("onCurve"));
  });

  it("removes a closing cubic's handles without moving the contour's start", async () => {
    const { closingOut } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            ...PENTAGON,
            { x: 0, y: 67, off: true, name: "closingOut" },
            { x: 0, y: 33, off: true },
          ],
        },
      ],
    });
    const corners = (await editor.outline())[0]!.points.slice(0, 5);

    await expectEdit(
      editor,
      async (e) => {
        e.select([closingOut]);
        await e.deleteSelection();
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([{ closed: true, points: corners }]);
        expect((await e.outline())[0]!.points).toHaveLength(5);
      },
    );
  });

  it("removes unselected handles when every on-curve point is selected", async () => {
    const names = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            PENTAGON[0],
            { x: 33, y: 0, off: true },
            { x: 67, y: 0, off: true },
            ...PENTAGON.slice(1),
          ],
        },
      ],
    });
    editor.select([names.p0, names.p1, names.p2, names.p3, names.p4]);

    await editor.deleteSelection();

    expect(await editor.outline()).toEqual([]);
  });
});
