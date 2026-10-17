import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnchorId, GlyphName, SourceId } from "@shift/types";
import { signal } from "@shift/editor/signals";
import { PositionEdits } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";

const FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/AnchorPropagation.glyphs");

describe("adding, renaming, and deleting anchors", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FIXTURE, "a");
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  });

  const glyph = (name: string) =>
    editor.glyphForId(editor.font.recordForName(name as GlyphName)!.id)!;
  const anchorNames = (name: string, sourceId: SourceId) =>
    glyph(name)
      .layerForSource(sourceId)!
      .anchors.map((anchor) => anchor.name);
  const sources = () => {
    const active = editor.font.defaultSource.id;
    const other = editor.font.sources.find((source) => source.id !== active)!.id;
    return { active, other };
  };
  const anchorId = (glyphName: string, name: string) =>
    glyph(glyphName)
      .layerForSource(sources().active)!
      .anchors.find((anchor) => anchor.name === name)!.id;
  /** Edits the other master together with the active one, once their layers are matched. */
  const editBothSources = async () => {
    editor.selectSourceForEditing(sources().active);
    editor.selectSourceForEditing(sources().other, "toggle");
    await expect.poll(() => editor.editingLayerMatchesCell.peek().size).toBe(1);
  };

  it("renames an anchor in the source being edited, follows into composites, and undoes", async () => {
    const { active, other } = sources();
    const otherBefore = anchorNames("a", other);
    const aacute = glyph("aacute").renderModelAt(
      signal(editor.font.externalLocationForSource(active)!),
      signal(active),
    );

    expect(editor.renameAnchor(anchorId("a", "bottom"), "bottomleft")).toBe(true);
    await editor.settle();

    expect(anchorNames("a", active)).toContain("bottomleft");
    expect(anchorNames("a", other)).toEqual(otherBefore);
    expect(aacute.anchorNamed("bottomleft")).not.toBeNull();
    expect(aacute.anchorNamed("bottom")).toBeNull();

    await editor.undo();
    await editor.settle();
    expect(anchorNames("a", active)).not.toContain("bottomleft");
    expect(aacute.anchorNamed("bottom")).not.toBeNull();
  });

  it("renames, adds, and deletes in every source selected for editing", async () => {
    const { active, other } = sources();
    await editBothSources();

    expect(editor.renameAnchor(anchorId("a", "bottom"), "bottomleft")).toBe(true);
    await editor.settle();
    expect(anchorNames("a", active)).toContain("bottomleft");
    expect(anchorNames("a", other)).toContain("bottomleft");

    expect(editor.addAnchorAtPointer()).toBe(true);
    await editor.settle();
    expect(anchorNames("a", active)).toContain("new");
    expect(anchorNames("a", other)).toContain("new");

    await expect.poll(() => editor.editingLayerMatchesCell.peek().size).toBe(1);
    editor.selection.select([anchorId("a", "ogonek")]);
    expect(await editor.deleteSelection()).toBe(true);
    expect(anchorNames("a", active)).not.toContain("ogonek");
    expect(anchorNames("a", other)).not.toContain("ogonek");
  });

  it("deletes an anchor from the source being edited as one undo step", async () => {
    const { active, other } = sources();
    const before = anchorNames("a", active);
    const otherBefore = anchorNames("a", other);
    editor.selection.select([anchorId("a", "ogonek")]);

    expect(await editor.deleteSelection()).toBe(true);

    expect(anchorNames("a", active)).not.toContain("ogonek");
    expect(anchorNames("a", other)).toEqual(otherBefore);
    await editor.undo();
    await editor.settle();
    expect(anchorNames("a", active)).toEqual(before);
  });

  it("adds an anchor at the pointer to the source being edited and selects it", async () => {
    const { active, other } = sources();
    const point = editor.localToScreen({ x: 120, y: 340 });
    // As the canvas context menu reports the pointer before running the command.
    editor.updateMousePosition(point.x, point.y);
    editor.flushMousePosition();

    expect(editor.addAnchorAtPointer()).toBe(true);
    await editor.settle();

    const [selected] = editor.selection.ids;
    expect(editor.anchorPosition(selected as AnchorId)).toEqual({ x: 120, y: 340 });
    expect(anchorNames("a", other)).not.toContain("new");

    expect(editor.addAnchorAtPointer()).toBe(true);
    await editor.settle();
    expect(anchorNames("a", active)).toContain("new.1");
  });

  it("moves several anchors to one coordinate, keeping other sources relative", async () => {
    const { active, other } = sources();
    await editBothSources();
    const at = (sourceId: SourceId, name: string) =>
      glyph("a")
        .layerForSource(sourceId)!
        .anchors.find((anchor) => anchor.name === name)!;
    const otherTopBefore = at(other, "top").x;
    const activeTopBefore = at(active, "top").x;

    expect(editor.setAnchorAxis([anchorId("a", "top"), anchorId("a", "ogonek")], "x", 300)).toBe(
      true,
    );
    await editor.settle();

    expect(at(active, "top").x).toBe(300);
    expect(at(active, "ogonek").x).toBe(300);
    expect(at(other, "top").x).toBe(otherTopBefore + (300 - activeTopBefore));
  });

  it("adds an anchor on the baseline at the middle of the advance", async () => {
    const layer = glyph("a").layerForSource(sources().active)!;

    expect(editor.addAnchorAt()).toBe(true);
    await editor.settle();

    const added = layer.anchors.find((anchor) => anchor.name === "new")!;
    expect({ x: added.x, y: added.y }).toEqual({ x: Math.round(layer.xAdvance / 2), y: 0 });
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
