import { describe, expect, it } from "vitest";
import { Curve, Vec2, type CubicCurve } from "@shift/geo";
import { expectEdit } from "@/testing/expectEdit";
import type { OutlinePoint } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();

const ORIGINAL = Curve.cubic(
  { x: 0, y: 0 },
  { x: 50, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 0 },
);

/** Splits `curve` at each of `ts` in turn, each `t` measured along what is left. */
function split(curve: CubicCurve, ...ts: number[]): CubicCurve[] {
  const pieces: CubicCurve[] = [];
  let rest = curve;
  for (const t of ts) {
    const [left, right] = Curve.splitAt(rest, t) as [CubicCurve, CubicCurve];
    pieces.push(left);
    rest = right;
  }
  return [...pieces, rest];
}

type Piece = 0 | 1 | 2;
type CubicPointName = `p${Piece | 3}` | `c${Piece}a` | `c${Piece}b`;

/** An on-curve point or control of {@link cubicContour}, always named. */
interface NamedPoint {
  readonly x: number;
  readonly y: number;
  readonly off?: true;
  readonly name: CubicPointName;
}

/**
 * An open contour of up to three cubic pieces, naming the on-curve points
 * `p0`, `p1`… and each piece's controls `c0a`, `c0b`, `c1a`…
 */
function cubicContour(pieces: readonly CubicCurve[]): { readonly points: readonly NamedPoint[] } {
  const start: NamedPoint = { ...pieces[0]!.p0, name: "p0" };
  return {
    points: [
      start,
      ...pieces.flatMap((piece, index): NamedPoint[] => [
        { ...piece.c0, off: true, name: `c${index as Piece}a` },
        { ...piece.c1, off: true, name: `c${index as Piece}b` },
        { ...piece.p1, name: `p${(index + 1) as Piece | 3}` },
      ]),
    ],
  };
}

/** The cubic an open contour of four points describes. */
function cubicOf(points: readonly OutlinePoint[]): CubicCurve {
  const [p0, c0, c1, p1] = points;
  if (!p0 || !c0 || !c1 || !p1) throw new Error("a cubic needs four points");
  return Curve.cubic(p0, c0, c1, p1);
}

/** The furthest any of `count` samples along `a` lies from the same parameter on `b`. */
function maxDistance(a: CubicCurve, b: CubicCurve, count = 40): number {
  return Math.max(
    ...Curve.sample(a, count).map((point, index) =>
      Vec2.dist(point, Curve.pointAt(b, index / count)),
    ),
  );
}

/** The open glyph's only contour as positions and kinds, leaving out the ids a fit mints. */
async function onlyContourShape(
  e: EditorTestSurface,
): Promise<readonly Omit<OutlinePoint, "id">[]> {
  return (await onlyContourPoints(e)).map(({ x, y, pointType, smooth }) => ({
    x,
    y,
    pointType,
    smooth,
  }));
}

async function onlyContourPoints(e: EditorTestSurface): Promise<readonly OutlinePoint[]> {
  const [contour] = await e.outline();
  return contour?.points ?? [];
}

describe("deleting an on-curve point fits a curve across its span", () => {
  it("recovers a split cubic and keeps its endpoints", async () => {
    const names = await editor.draw({ contours: [cubicContour(split(ORIGINAL, 0.4))] });

    await expectEdit(
      editor,
      async (e) => {
        e.select([names.p1]);
        expect(await e.deleteSelection()).toBe(true);
      },
      async (e) => {
        const points = await onlyContourPoints(e);
        expect(points.map(({ pointType }) => pointType)).toEqual([
          "onCurve",
          "offCurve",
          "offCurve",
          "onCurve",
        ]);
        expect([points[0]!.id, points[3]!.id]).toEqual([names.p0, names.p2]);
        expect(maxDistance(ORIGINAL, cubicOf(points))).toBeLessThan(0.1);
        expect(e.selectionIds()).toEqual([]);
      },
    );
  });

  it("fits the same curve when the point's handles are selected with it", async () => {
    const names = await editor.draw({ contours: [cubicContour(split(ORIGINAL, 0.4))] });
    editor.select([names.p1]);
    await editor.deleteSelection();
    const fitted = await onlyContourShape(editor);
    await editor.undo();

    editor.select([names.c0a, names.p1]);
    await editor.deleteSelection();

    expect(await onlyContourShape(editor)).toEqual(fitted);
  });

  it("fits adjacent selected points once, whatever order they were selected in", async () => {
    const names = await editor.draw({ contours: [cubicContour(split(ORIGINAL, 0.3, 0.6))] });
    editor.select([names.p1, names.p2]);
    await editor.deleteSelection();
    const fitted = await onlyContourShape(editor);
    await editor.undo();

    editor.select([names.p2, names.p1]);
    await editor.deleteSelection();

    expect(fitted).toHaveLength(4);
    expect(await onlyContourShape(editor)).toEqual(fitted);
  });

  it("treats a clicked segment like all of its points selected", async () => {
    const pieces = split(ORIGINAL, 0.25, 0.65);
    const names = await editor.draw({ contours: [cubicContour(pieces)] });
    editor.select([names.p1, names.c1a, names.c1b, names.p2]);
    await editor.deleteSelection();
    const fitted = await onlyContourShape(editor);
    await editor.undo();

    await editor.clickAt(Curve.pointAt(pieces[1]!, 0.5));
    await editor.deleteSelection();

    expect(await onlyContourShape(editor)).toEqual(fitted);
  });

  it("leaves the two endpoints apart when a gap removes the only two segments", async () => {
    const names = await editor.draw({ contours: [cubicContour(split(ORIGINAL, 0.4))] });
    editor.select([names.p1]);

    await editor.deleteSelection("gap");

    expect(await editor.outline()).toMatchObject([
      { closed: false, points: [{ id: names.p0, pointType: "onCurve" }] },
      { closed: false, points: [{ id: names.p2, pointType: "onCurve" }] },
    ]);
  });

  it("does not delete while an interpolated location is shown", async () => {
    await editor.draw({ contours: [cubicContour([ORIGINAL])] });
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
        expect(await onlyContourPoints(e)).toEqual([
          { id: a, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: c, x: 200, y: 0, pointType: "onCurve", smooth: false },
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
    const untouched = (await onlyContourPoints(editor)).slice(2);
    editor.select([b]);

    await editor.deleteSelection();

    const points = await onlyContourPoints(editor);
    expect(points.map(({ pointType }) => pointType)).toEqual([
      "onCurve",
      "onCurve",
      "offCurve",
      "offCurve",
      "onCurve",
    ]);
    expect(points.slice(1)).toEqual(untouched);
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

    expect(await onlyContourPoints(editor)).toMatchObject([
      { id: a, pointType: "onCurve" },
      { pointType: "offCurve" },
      { pointType: "offCurve" },
      { id: c, pointType: "onCurve" },
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
        const points = await onlyContourPoints(e);
        expect(points.map(({ pointType }) => pointType)).toEqual(result);
        expect([points[0]!.id, points.at(-1)!.id]).toEqual([start, end]);
      },
    );
  });
});
