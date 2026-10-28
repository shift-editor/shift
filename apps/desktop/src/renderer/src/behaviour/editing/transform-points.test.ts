import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";
import type { PointId } from "@shift/types";

let editor: EditorTestSurface;
let a: PointId;
let b: PointId;
let c: PointId;
beforeEach(async () => {
  editor = await startTestEditor();
  ({ a, b, c } = await editor.draw({
    contours: [
      {
        points: [
          { x: 10, y: 20, name: "a" },
          { x: 30, y: 40, name: "b" },
          { x: 90, y: 0, name: "c" },
        ],
      },
    ],
  }));
});
afterEach(() => editor.close());

describe("transforming selected points from the sidebar", () => {
  it("rotates the selection about its center as one undo step", async () => {
    await expectEdit(
      editor,
      (e) => {
        e.select([a, b]);
        expect(e.rotateSelection(180)).toBe(true);
      },
      async (e) => {
        const positions = await e.pointPositions([a, b, c]);
        expect(positions[a]!.x).toBeCloseTo(30);
        expect(positions[a]!.y).toBeCloseTo(40);
        expect(positions[b]!.x).toBeCloseTo(10);
        expect(positions[b]!.y).toBeCloseTo(20);
        expect(positions[c]).toEqual({ x: 90, y: 0 });
      },
    );
  });

  it("flips the selection across its center", async () => {
    await expectEdit(
      editor,
      (e) => {
        e.select([a, b, c]);
        expect(e.flipSelection("horizontal")).toBe(true);
      },
      {
        [a]: { x: 90, y: 20 },
        [b]: { x: 70, y: 40 },
        [c]: { x: 10, y: 0 },
      },
    );
  });

  it("aligns the selection to the top of its bounds", async () => {
    await expectEdit(
      editor,
      (e) => {
        e.select([a, b]);
        expect(e.alignSelection("top")).toBe(true);
      },
      {
        [a]: { x: 10, y: 40 },
        [b]: { x: 30, y: 40 },
        [c]: { x: 90, y: 0 },
      },
    );
  });

  it("spaces the selection evenly between its outermost points", async () => {
    await expectEdit(
      editor,
      (e) => {
        e.select([a, b, c]);
        expect(e.distributeSelection("horizontal")).toBe(true);
      },
      async (e) => {
        const positions = await e.pointPositions([a, b, c]);
        expect([positions[a]!.x, positions[b]!.x, positions[c]!.x]).toEqual([10, 50, 90]);
      },
    );
  });
});
