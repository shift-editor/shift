import { describe, expect, it } from "vitest";
import { mintPointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { square } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("deleting points", () => {
  it("joins an open contour's neighbours across a deleted corner", async () => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y: 50, name: "b" },
            { x: 200, y: 0, name: "c" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([b]);
        expect(await e.deleteSelection()).toBe(true);
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([
          { closed: false, points: [{ id: a }, { id: c }] },
        ]);
      },
    );
  });

  it("keeps a closed contour closed when one corner goes", async () => {
    await editor.draw({ contours: [square(100)] });
    const [corner] = (await editor.outline())[0]!.points;

    await expectEdit(
      editor,
      async (e) => {
        e.select([corner!.id]);
        await e.deleteSelection();
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            closed: true,
            points: [
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
          },
        ]);
      },
    );
  });
});

const ZIGZAG = [
  { x: 0, y: 0, name: "p0" },
  { x: 100, y: 0, name: "p1" },
  { x: 200, y: 100, name: "p2" },
  { x: 300, y: 0, name: "p3" },
  { x: 400, y: 0, name: "p4" },
] as const;

const PENTAGON = [
  { x: 0, y: 0, name: "p0" },
  { x: 100, y: 0, name: "p1" },
  { x: 200, y: 100, name: "p2" },
  { x: 100, y: 200, name: "p3" },
  { x: 0, y: 100, name: "p4" },
] as const;

describe("deleting from an open contour keeps the surviving runs", () => {
  it("splits around a gap without joining the two runs", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({ contours: [{ points: ZIGZAG }] });
    const [original] = await editor.outline();

    await expectEdit(
      editor,
      async (e) => {
        e.select([p2]);
        await e.deleteSelection("gap");
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([
          { id: original!.id, closed: false, points: [{ id: p0 }, { id: p1 }] },
          { closed: false, points: [{ id: p3 }, { id: p4 }] },
        ]);
      },
    );
  });

  it("joins line-only spans with lines around a surviving point", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({ contours: [{ points: ZIGZAG }] });
    editor.select([p1, p3]);

    await editor.deleteSelection();

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { id: p0, pointType: "onCurve" },
          { id: p2, pointType: "onCurve" },
          { id: p4, pointType: "onCurve" },
        ],
      },
    ]);
    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p0 }, { id: p2 }, { id: p4 }] },
    ]);
  });

  it("keeps each surviving point between several gaps", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({ contours: [{ points: ZIGZAG }] });
    editor.select([p1, p3]);

    await editor.deleteSelection("gap");

    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p0 }] },
      { points: [{ id: p2 }] },
      { points: [{ id: p4 }] },
    ]);
  });

  it.each(["fit", "gap"] as const)("trims the ends without fitting in %s mode", async (mode) => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({ contours: [{ points: ZIGZAG }] });
    editor.select([p0, p4]);

    await editor.deleteSelection(mode);

    expect(await editor.outline()).toMatchObject([{ closed: false }]);
    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p1 }, { id: p2 }, { id: p3 }] },
    ]);
  });

  it("leaves other contours and their order alone", async () => {
    const { p2 } = await editor.draw({
      contours: [{ points: ZIGZAG }, { points: [[600, 0], { x: 700, y: 0, off: true }, [800, 0]] }],
    });
    const [, untouched] = await editor.outline();
    editor.select([p2]);

    await editor.deleteSelection("gap");

    expect((await editor.outline())[1]).toEqual(untouched);
  });
});

describe("deleting from a closed contour wraps around its start", () => {
  it("joins a line-only run across the start without adding handles", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({
      contours: [{ closed: true, points: PENTAGON }],
    });
    editor.select([p4, p0]);

    await editor.deleteSelection();

    expect(await editor.outline()).toMatchObject([
      {
        closed: true,
        points: [
          { id: p1, pointType: "onCurve" },
          { id: p2, pointType: "onCurve" },
          { id: p3, pointType: "onCurve" },
        ],
      },
    ]);
    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p1 }, { id: p2 }, { id: p3 }] },
    ]);
  });

  it("opens around an interior gap, keeping the run that wraps the start", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({
      contours: [{ closed: true, points: PENTAGON }],
    });
    editor.select([p2]);

    await editor.deleteSelection("gap");

    expect(await editor.outline()).toMatchObject([{ closed: false }]);
    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p3 }, { id: p4 }, { id: p0 }, { id: p1 }] },
    ]);
  });

  it("opens a gap across the start", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({
      contours: [{ closed: true, points: PENTAGON }],
    });
    editor.select([p4, p0]);

    await editor.deleteSelection("gap");

    expect(await editor.outline()).toMatchObject([{ closed: false }]);
    expect(await editor.outline()).toMatchObject([
      { points: [{ id: p1 }, { id: p2 }, { id: p3 }] },
    ]);
  });

  it("keeps two surviving points as a closed contour of two straight sides", async () => {
    const { p0, p1, p2, p3, p4 } = await editor.draw({
      contours: [{ closed: true, points: PENTAGON }],
    });
    editor.select([p0, p2, p4]);

    await editor.deleteSelection();

    expect(await editor.outline()).toMatchObject([
      {
        closed: true,
        points: [
          { id: p1, pointType: "onCurve" },
          { id: p3, pointType: "onCurve" },
        ],
      },
    ]);
    expect(await editor.outline()).toMatchObject([{ points: [{ id: p1 }, { id: p3 }] }]);
  });

  it.each(["fit", "gap"] as const)(
    "keeps one surviving point as an open contour in %s mode",
    async (mode) => {
      const { p0, p1, p2, p3, p4 } = await editor.draw({
        contours: [{ closed: true, points: PENTAGON }],
      });
      editor.select([p1, p2, p3, p4]);

      await editor.deleteSelection(mode);

      expect(await editor.outline()).toMatchObject([{ closed: false, points: [{ id: p0 }] }]);
      expect(await editor.outline()).toMatchObject([{ points: [{ id: p0 }] }]);
    },
  );

  it("removes a selected whole contour, and undo puts it back in order", async () => {
    await editor.draw({ contours: [{ closed: true, points: PENTAGON }] });
    const [contour] = await editor.outline();

    await expectEdit(
      editor,
      async (e) => {
        e.selectObjects([contour!.id]);
        await e.deleteSelection();
      },
      async (e) => {
        expect(await e.outline()).toEqual([]);
      },
    );
  });
});

describe("deleting refuses an empty or unsupported selection without editing", () => {
  it("adds no undo step when nothing is selected", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [0, 0],
            [100, 0],
          ],
        },
      ],
    });

    expect(await editor.deleteSelection()).toBe(false);
    await editor.undo();

    expect(await editor.outline()).toEqual([]);
  });

  it("refuses a selection holding an id the glyph no longer has", async () => {
    const { p0 } = await editor.draw({ contours: [{ points: ZIGZAG }] });
    const before = await editor.outline();
    editor.select([p0, mintPointId()]);

    expect(await editor.deleteSelection()).toBe(false);

    expect(await editor.outline()).toEqual(before);
  });

  it("deletes selected anchors as one undoable edit", async () => {
    await editor.draw({
      anchors: [
        { name: "top", x: 0, y: 100 },
        { name: "bottom", x: 0, y: 0 },
      ],
    });
    const [top, bottom] = await editor.anchors();
    editor.selectObjects([top!.id]);

    expect(await editor.deleteSelection()).toBe(true);
    expect(await editor.anchors()).toEqual([bottom]);
    expect(editor.selectionIds()).toEqual([]);

    await editor.undo();
    await editor.settle();
    expect(await editor.anchors()).toEqual([top, bottom]);
  });

  it("keeps everything when anchors are mixed into a point selection", async () => {
    const { p0 } = await editor.draw({
      contours: [{ points: [ZIGZAG[0]] }],
      anchors: [{ name: "top", x: 0, y: 100 }],
    });
    const [anchor] = await editor.anchors();
    const before = await editor.outline();
    editor.selectObjects([p0, anchor!.id]);

    expect(await editor.deleteSelection()).toBe(false);

    expect(await editor.outline()).toEqual(before);
    expect(await editor.anchors()).toEqual([anchor]);
  });
});
