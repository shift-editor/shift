import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { square } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

// Away from the test font's metrics and from the other points, so only the grid can snap.
const editor = useTestEditor({
  glyphs: { dot: { outline: { contours: [square(100)] } } },
});
let corner: PointId;

beforeEach(async () => {
  ({ corner } = await editor.draw({
    contours: [{ points: [[300, 120], { x: 330, y: 160, name: "corner" }, [560, 120]] }],
  }));
  editor.selectTool("select");
});

describe("dragging points snaps them to the grid while snapping to it is on", () => {
  it("lands a dragged point on the nearest grid intersection", async () => {
    editor.setGrid({ spacingX: 100, spacingY: 100, snap: true });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 412, y: 291 });

    expect(await editor.point(corner)).toMatchObject({ x: 400, y: 300 });
  });

  it("lands on subdivision intersections too", async () => {
    editor.setGrid({ spacingX: 100, spacingY: 100, subdivisions: 2, snap: true });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 438, y: 262 });

    expect(await editor.point(corner)).toMatchObject({ x: 450, y: 250 });
  });

  it("snaps each axis to its own spacing", async () => {
    editor.setGrid({ spacingX: 100, spacingY: 40, snap: true });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 412, y: 291 });

    expect(await editor.point(corner)).toMatchObject({ x: 400, y: 280 });
  });

  it("leaves the point where it was dropped while snapping is off", async () => {
    editor.setGrid({ spacingX: 100, spacingY: 100, visible: true, snap: false });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 412, y: 291 });

    expect(await editor.point(corner)).toMatchObject({ x: 412, y: 291 });
  });

  it("suspends grid snapping while Cmd is held", async () => {
    editor.setGrid({ snap: true });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 412, y: 291 }, { metaKey: true });

    expect(await editor.point(corner)).toMatchObject({ x: 412, y: 291 });
  });

  it("still prefers a metric line nearer than the grid", async () => {
    const { xHeight } = editor.metrics();
    if (xHeight === undefined) throw new Error("Expected the test font to author an x-height");
    editor.setGrid({ spacingX: 100, spacingY: 1000, snap: true });

    await editor.dragFrom({ x: 330, y: 160 }, { x: 412, y: xHeight - editor.hitDistance() / 2 });

    expect(await editor.point(corner)).toMatchObject({ x: 400, y: xHeight });
  });
});

describe("the Pen places new points on the grid while snapping to it is on", () => {
  it("places a clicked point on the nearest grid intersection", async () => {
    editor.setGrid({ spacingX: 50, spacingY: 50, snap: true });
    editor.selectTool("pen");

    await editor.clickAt({ x: 1212, y: 1338 });

    const [, placed] = await editor.outline();
    expect(placed).toMatchObject({ points: [{ x: 1200, y: 1350 }] });
  });
});

describe("moving a component snaps its placement to the grid", () => {
  it("lands the component's offset on a grid intersection", async () => {
    await editor.draw({ components: [{ glyph: "dot" }] });
    await editor.clickAt({ x: 50, y: 50 });
    editor.setGrid({ spacingX: 100, spacingY: 100, snap: true });

    await editor.dragFrom({ x: 50, y: 50 }, { x: 140, y: 162 });

    expect(await editor.components()).toMatchObject([{ transformation: { dx: 100, dy: 100 } }]);
  });
});

describe("G toggles snapping to the grid", () => {
  it("turns snapping on and off from the View menu's command", async () => {
    expect(editor.gridSettings()).toMatchObject({ snap: false });

    await editor.runCommand("view.toggleSnapToGrid");
    expect(editor.gridSettings()).toMatchObject({ snap: true });

    await editor.runCommand("view.toggleSnapToGrid");
    expect(editor.gridSettings()).toMatchObject({ snap: false });
  });

  it("shows and hides the grid from the View menu's command", async () => {
    await editor.runCommand("view.toggleGrid");

    expect(editor.gridSettings()).toMatchObject({ visible: true, snap: false });
  });
});
