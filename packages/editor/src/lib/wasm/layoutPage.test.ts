import { describe, expect, it } from "vitest";
import { layoutPage, type LayoutNodeInput, type LayoutSizing } from "./generated/shapingLayouts";

const hug: LayoutSizing = { mode: "hug", size: 0 };
const fill: LayoutSizing = { mode: "fill", size: 0 };
const fixed = (size: number): LayoutSizing => ({ mode: "fixed", size });

const node = (
  kind: LayoutNodeInput["kind"],
  parent: number | null,
  fields: Partial<LayoutNodeInput> = {},
): LayoutNodeInput => ({
  kind,
  parent,
  width: hug,
  height: hug,
  placement: "auto",
  x: 0,
  y: 0,
  ...fields,
});

/** Three words of width 30 with a space of 10 after each, 12 units apart. */
const threeWords = {
  widths: [30, 30, 30],
  trailing: [10, 10, 10],
  hardBreaks: [],
  lineHeight: 12,
  scale: 1,
};

describe("layoutPage", () => {
  it("lays out a column of wrapping text and a leaf through the shaping module", () => {
    const layout = layoutPage({
      nodes: [
        node("page", null),
        node("frame", 0, {
          x: 100,
          y: 50,
          width: fixed(85),
          frame: {
            mode: "column",
            gap: 10,
            padding: { top: 5, right: 5, bottom: 5, left: 5 },
            align: "start",
            justify: "space-between",
            wrap: false,
          },
        }),
        node("text", 1, { width: fill, text: threeWords }),
        node("fixed", 1, { intrinsic: { width: 20, height: 8 } }),
        node("fixed", 1, {
          placement: "absolute",
          x: -10,
          y: -10,
          intrinsic: { width: 4, height: 4 },
        }),
      ],
    });

    expect(layout?.boxes).toEqual([
      { x: 0, y: 0, width: 185, height: 102 },
      { x: 100, y: 50, width: 85, height: 52 },
      { x: 5, y: 5, width: 75, height: 24 },
      { x: 5, y: 39, width: 20, height: 8 },
      { x: -10, y: -10, width: 4, height: 4 },
    ]);
    expect(layout?.textLines).toEqual([
      {
        node: 2,
        lines: [
          { start: 0, end: 2, width: 70 },
          { start: 2, end: 3, width: 30 },
        ],
      },
    ]);
  });

  it("returns null for a tree whose first node is not a page", () => {
    expect(layoutPage({ nodes: [node("frame", null)] })).toBeNull();
  });
});
