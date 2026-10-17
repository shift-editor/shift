import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnchorId, GlyphName } from "@shift/types";
import { signal } from "@shift/editor/signals";
import { PositionEdits } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";

const FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/AnchorPropagation.glyphs");

describe("adding and renaming anchors", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FIXTURE, "a");
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  });

  const glyph = (name: string) =>
    editor.glyphForId(editor.font.recordForName(name as GlyphName)!.id)!;
  const namesBySource = (name: string) =>
    glyph(name).layers.map((layer) => layer.anchors.map((anchor) => anchor.name));

  it("renames an anchor in every source, follows into composites, and undoes as one step", async () => {
    const before = namesBySource("a");
    const bottom = glyph("a")
      .layerForSource(editor.font.defaultSource.id)!
      .anchors.find((anchor) => anchor.name === "bottom")!;
    const source = editor.font.defaultSource;
    const aacute = glyph("aacute").renderModelAt(
      signal(editor.font.externalLocationForSource(source.id)!),
      signal(source.id),
    );

    expect(editor.renameAnchor(bottom.id, "bottomleft")).toBe(true);
    await editor.settle();

    expect(namesBySource("a")).toEqual(
      before.map((names) => names.map((name) => (name === "bottom" ? "bottomleft" : name))),
    );
    expect(aacute.anchorNamed("bottomleft")).not.toBeNull();
    expect(aacute.anchorNamed("bottom")).toBeNull();

    await editor.undo();
    await editor.settle();
    expect(namesBySource("a")).toEqual(before);
    expect(aacute.anchorNamed("bottom")).not.toBeNull();
  });

  it("adds an anchor at the pointer to every source and selects it", async () => {
    const point = editor.localToScreen({ x: 120, y: 340 });
    // As the canvas context menu reports the pointer before running the command.
    editor.updateMousePosition(point.x, point.y);
    editor.flushMousePosition();

    expect(editor.addAnchorAtPointer()).toBe(true);
    await editor.settle();

    for (const layer of glyph("a").layers) {
      const added = layer.anchors.find((anchor) => anchor.name === "new");
      expect(added && { x: added.x, y: added.y }).toEqual({ x: 120, y: 340 });
    }
    const [selected] = editor.selection.ids;
    expect(editor.anchorPosition(selected as AnchorId)).toEqual({ x: 120, y: 340 });

    expect(editor.addAnchorAtPointer()).toBe(true);
    await editor.settle();
    expect(namesBySource("a")[0]).toContain("new.1");
  });

  it("moves components attached to a moved anchor, in composites the editor holds", async () => {
    const source = editor.font.defaultSource;
    const aacute = glyph("aacute").layerForSource(source.id)!;
    const acuteX = () => aacute.geometry.components[1]!.matrix.e;
    expect(acuteX()).toBe(150);

    const layer = glyph("a").layerForSource(source.id)!;
    const top = layer.anchors.find((anchor) => anchor.name === "top")!;
    const [position] = layer.positionsFor([{ kind: "anchor", id: top.id }]);
    layer.applyPositionPatch([{ ...position!, x: position!.x + 30 }]);
    await editor.settle();

    expect(acuteX()).toBe(180);
  });

  it("moves attached components in other glyphs live while the anchor is dragged", async () => {
    const source = editor.font.defaultSource;
    const aacute = glyph("aacute").renderModelAt(
      signal(editor.font.externalLocationForSource(source.id)!),
      signal(source.id),
    );
    const acuteId = glyph("acutecomb").id;
    const acuteX = () => aacute.components.find((c) => c.glyphId === acuteId)!.transform.e;
    const topX = () => aacute.anchorNamed("top")!.x;
    expect(acuteX()).toBe(150);
    expect(topX()).toBe(250);

    const layer = glyph("a").layerForSource(source.id)!;
    const top = layer.anchors.find((anchor) => anchor.name === "top")!;
    const selection = editor.positionSelection([top.id])!;
    const move = PositionEdits.fromSelection(selection).move(selection.targets);

    move.preview({ x: 30, y: 10 });
    expect(acuteX()).toBe(180);
    expect(topX()).toBe(280);

    move.commit("Move anchor");
    expect(acuteX()).toBe(180);
    await editor.settle();
    expect(acuteX()).toBe(180);
    expect(topX()).toBe(280);
  });
});
