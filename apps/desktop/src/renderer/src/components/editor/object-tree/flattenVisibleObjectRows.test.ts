import { describe, expect, it } from "vitest";
import { asContourId, asPointId } from "@shift/types";
import type { ObjectTreeItem } from "@/types/objectTree";
import { flattenVisibleObjectRows } from "./flattenVisibleObjectRows";

const contourId = asContourId("contour-1");
const firstPointId = asPointId("point-1");
const secondPointId = asPointId("point-2");
const items: readonly ObjectTreeItem[] = [
  {
    id: contourId,
    kind: "contour",
    icon: "contour",
    label: "Contour 1",
    children: [
      { id: firstPointId, kind: "point", icon: "line", label: "Point 1", children: [] },
      { id: secondPointId, kind: "point", icon: "curve", label: "Point 2", children: [] },
    ],
  },
];

describe("visible object rows", () => {
  it("uses preorder and records each visible nesting depth", () => {
    const rows = flattenVisibleObjectRows(items, new Set());

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      [contourId, 0],
      [firstPointId, 1],
      [secondPointId, 1],
    ]);
  });

  it("keeps a collapsed object visible while omitting its descendants", () => {
    const rows = flattenVisibleObjectRows(items, new Set([contourId]));

    expect(rows.map((row) => row.item.id)).toEqual([contourId]);
  });
});
