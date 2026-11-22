import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { useTestEditor } from "@/testing/fontFixture";

const ROUND_40 = {
  width: 40,
  cap: "round" as const,
  join: "round" as const,
  miterLimit: 4,
  position: 0,
};

describe("ink alignment snapping", () => {
  const editor = useTestEditor();

  it("snaps an unstroked point to the ink right edge of a stroked contour", async () => {
    const { target } = await editor.draw({
      contours: [
        {
          points: [
            [200, 0],
            [200, 400],
          ],
          closed: false,
        },
        { points: [{ x: 300, y: 200, name: "target" }, [400, 200]], closed: false },
      ],
    });

    const contours = await editor.outline();
    editor.select(contours[0]!.points.map((p) => p.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    editor.selectTool("select");
    editor.select([target as PointId]);

    const hitDist = editor.hitDistance();
    await editor.dragFrom({ x: 300, y: 200 }, { x: 220 + hitDist / 3, y: 200 });

    const point = await editor.point(target as PointId);
    expect(point!.x).toBeGreaterThan(215);
    expect(point!.x).toBeLessThan(225);
  });

  it("snaps an unstroked point to the ink left edge of a stroked contour", async () => {
    const { target } = await editor.draw({
      contours: [
        {
          points: [
            [200, 0],
            [200, 400],
          ],
          closed: false,
        },
        { points: [{ x: 100, y: 200, name: "target" }, [0, 200]], closed: false },
      ],
    });

    const contours = await editor.outline();
    editor.select(contours[0]!.points.map((p) => p.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    editor.selectTool("select");
    editor.select([target as PointId]);

    const hitDist = editor.hitDistance();
    await editor.dragFrom({ x: 100, y: 200 }, { x: 180 - hitDist / 3, y: 200 });

    const point = await editor.point(target as PointId);
    expect(point!.x).toBeGreaterThan(175);
    expect(point!.x).toBeLessThan(185);
  });

  it("without stroke, snaps to skeleton not ink", async () => {
    const { target } = await editor.draw({
      contours: [
        {
          points: [
            [200, 0],
            [200, 400],
          ],
          closed: false,
        },
        { points: [{ x: 300, y: 200, name: "target" }, [400, 200]], closed: false },
      ],
    });

    editor.selectTool("select");
    editor.select([target as PointId]);

    const hitDist = editor.hitDistance();
    await editor.dragFrom({ x: 300, y: 200 }, { x: 200 + hitDist / 3, y: 200 });

    const point = await editor.point(target as PointId);
    expect(Math.abs(point!.x - 200)).toBeLessThan(2);
  });

  it("ink probes of a moving stroked contour snap to another contour's ink", async () => {
    // Two vertical skeletons: one at x = 100, one at x = 300. Both stroked.
    await editor.draw({
      contours: [
        {
          points: [
            [100, 0],
            [100, 400],
          ],
          closed: false,
        },
        {
          points: [
            [300, 0],
            [300, 400],
          ],
          closed: false,
        },
      ],
    });

    const contours = await editor.outline();
    const allPoints = contours.flatMap((c) => c.points.map((p) => p.id as PointId));
    editor.select(allPoints);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    // Select second contour and drag it toward contour 1.
    // Contour 1's ink right edge ≈ 120. Contour 2's ink left = skeleton - 20.
    // For ink edges to align: skeleton_2 - 20 = 120 → skeleton_2 = 140.
    editor.selectTool("select");
    const secondPoints = contours[1]!.points.map((p) => p.id as PointId);
    editor.select(secondPoints);

    const hitDist = editor.hitDistance();
    await editor.dragFrom({ x: 300, y: 200 }, { x: 140 + hitDist / 3, y: 200 });

    const p = await editor.point(secondPoints[0]!);
    // Skeleton should land at ≈ 140 (ink left at 120 = contour 1's ink right)
    expect(p!.x).toBeGreaterThan(135);
    expect(p!.x).toBeLessThan(145);
  });
});
