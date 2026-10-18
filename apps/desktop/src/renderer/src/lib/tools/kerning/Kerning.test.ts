import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { characterTextItem } from "@shift/editor/text";
import { trackRunLayouts, type KerningTool } from "@shift/editor/tools";
import { effect } from "@shift/editor/signals";
import { isGroupSide } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

// The run is "TA" at LightCondensed, the default source: T kerns with A's
// second-position group by -75 there.
describe("Kerning tool", () => {
  let editor: TestEditor;

  const placed = () => editor.text.layoutCell(editor.textRun!.runId).peek()!.placedGlyphs;
  const kern = () => {
    const [t, a] = placed();
    return a!.left - (t!.left + t!.glyph.xAdvance);
  };
  /** The middle of the kern, half way up the line, in the run's units. */
  const kernCenter = () => {
    const [t, a] = placed();
    return { x: (t!.left + t!.glyph.xAdvance + a!.left) / 2, y: 300 };
  };
  const hoverKern = () => {
    const screen = editor.localToScreen(kernCenter());
    editor.pointerMove(screen.x, screen.y);
  };
  const hovered = () => {
    const state = editor.toolIf("kerning")?.state;
    return state?.type === "ready" ? state.hit : undefined;
  };
  const tool = () => editor.toolManager.activeTool as KerningTool;
  const editedPair = () => hovered()!.editablePair(editor)!;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(MUTATOR_SANS, "T");
    await editor.font.loadGlyph(editor.font.recordForName("A" as GlyphName)!.id);
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);
    editor.escape();
    await editor.settle();
    editor.selectTool("kerning");
  });

  it("the Spacing tool shows nothing in a kerned gap's kern and leaves its sidebearings alone", async () => {
    editor.selectTool("spacing");
    const rsb = editor
      .glyphForId(placed()[0]!.glyph.glyphId!)!
      .layerForSource(editor.activeSourceId!)!.sidebearings.rsb;
    hoverKern();
    const state = editor.toolIf("spacing")?.state;

    expect(state?.type === "ready" && state.hit).toBe(null);

    const center = kernCenter();
    await editor.dragLocal({ down: center, start: center, end: { x: center.x + 40, y: center.y } });
    expect(
      editor.glyphForId(placed()[0]!.glyph.glyphId!)!.layerForSource(editor.activeSourceId!)!
        .sidebearings.rsb,
    ).toBe(rsb);
    expect(kern()).toBe(-75);
  });

  it("the Spacing tool hits and drags T's own RSB strip where it reaches into the kern", async () => {
    editor.selectTool("spacing");
    const [t] = placed();
    const tLayer = editor.glyphForId(t!.glyph.glyphId!)!.layerForSource(editor.activeSourceId!)!;
    const rsb = tLayer.sidebearings.rsb!;
    const tEnd = t!.left + t!.glyph.xAdvance;
    // Inside T's RSB strip: between its outline's right edge and its own advance edge.
    const inStrip = { x: tEnd - rsb / 2, y: 300 };
    const screen = editor.localToScreen(inStrip);
    editor.pointerMove(screen.x, screen.y);
    const state = editor.toolIf("spacing")?.state;
    const hit = state?.type === "ready" ? state.hit : null;
    expect(hit).toMatchObject({ side: "left", scope: "glyph" });
    expect(hit?.glyphSide?.glyphId).toBe(t!.glyph.glyphId);

    await editor.dragLocal({ down: inStrip, start: inStrip, end: { x: inStrip.x + 10, y: 300 } });
    expect(tLayer.sidebearings.rsb).toBe(rsb + 10);
    expect(kern()).toBe(-75);
  });

  it("finds every other pair the hovered kern applies to, and none it does not", () => {
    editor.selectTool("text");
    editor.textEditing.insert([
      characterTextItem(84),
      characterTextItem(65),
      characterTextItem(84),
    ]);
    editor.escape();
    editor.selectTool("kerning");
    hoverKern();

    // "TATAT": the second T–A uses the same kern; A–T pairs do not.
    const echoes = tool().runs.samePairs(hovered()!);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.amount).toBe(-75);
  });

  it("hovering between two glyphs shows their kern and the pair it comes from", () => {
    hoverKern();

    expect(hovered()!.amount).toBe(-75);
    expect(editedPair()).toMatchObject({
      first: editor.font.recordForName("T" as GlyphName)!.id,
      amount: -75,
    });
    expect(isGroupSide(editedPair().second)).toBe(true);
    expect(hovered()!.lock(editor, "first")).toEqual({ locked: true, toggleable: false });
    expect(hovered()!.lock(editor, "second")).toEqual({ locked: false, toggleable: true });
  });

  it("drops the selected pair when an undo takes one of its glyphs away", async () => {
    hoverKern();
    const screen = editor.localToScreen(kernCenter());
    editor.click(screen.x, screen.y);
    expect(tool().currentPair).not.toBeNull();

    // Undo past the typing removes the A, so T has no neighbour to kern with.
    await editor.undo();
    await editor.settle();

    expect(placed()).toHaveLength(1);
    expect(tool().currentPair).toBeNull();
  });

  it("dragging right opens the pair up as one undo step", async () => {
    const center = kernCenter();
    await editor.dragLocal({
      down: center,
      start: { x: center.x + 4, y: center.y },
      end: { x: center.x + 20, y: center.y },
    });
    await editor.settle();

    expect(kern()).toBe(-55);
    await editor.undo();
    expect(kern()).toBe(-75);
  });

  it("arrow keys nudge the selected pair, Shift by 10", async () => {
    hoverKern();
    const screen = editor.localToScreen({ x: kernCenter().x, y: 120 });
    await editor.click(screen.x, screen.y);

    editor.keyDown("ArrowLeft");
    await editor.settle();
    expect(kern()).toBe(-76);

    editor.keyDown("ArrowRight", { shiftKey: true });
    await editor.settle();
    expect(kern()).toBe(-66);
  });

  it("locking a side makes it an exception at the active source without moving the kern", async () => {
    hoverKern();

    expect(hovered()!.toggleLock(editor, "second")).toBe(true);
    await editor.settle();
    hoverKern();

    expect(editedPair().second).toBe(editor.font.recordForName("A" as GlyphName)!.id);
    expect(kern()).toBe(-75);
  });

  it("clicking the value in the zone below the baseline opens it for typing, which sets the kern", async () => {
    hoverKern();
    const { baseline, bottom } = hovered()!.gap;
    const pill = editor.localToScreen({ x: kernCenter().x, y: (baseline + bottom) / 2 });
    await editor.click(pill.x, pill.y);
    expect(tool().editing?.amount).toBe(-75);

    tool().setEditedKerning(-100);
    await editor.settle();

    expect(kern()).toBe(-100);
    expect(tool().editing?.amount).toBe(-100);
  });

  it("the selected pair is the one the sidebar shows", async () => {
    expect(tool().currentPair).toBeNull();
    const screen = editor.localToScreen({ x: kernCenter().x, y: 120 });
    await editor.click(screen.x, screen.y);

    expect(tool().currentPair?.amount).toBe(-75);
  });

  it("redraws its overlay when the active source changes", () => {
    const drawn: number[] = [];
    const overlay = effect(() => {
      trackRunLayouts(editor);
      drawn.push(placed()[1]!.left);
    });

    editor.selectSource(editor.font.sources.find((source) => source.name === "BoldWide")!.id);
    overlay.dispose();

    expect(drawn).toHaveLength(2);
    expect(drawn[1]).not.toBe(drawn[0]);
  });

  it("shares the Spacing slot and answers to K", () => {
    const shortcuts = editor.getToolShortcuts();
    expect(shortcuts).toContainEqual(expect.objectContaining({ toolId: "kerning", shortcut: "k" }));
    expect(editor.toolRegistry.get("kerning")?.hidden).toBe(true);
    expect(editor.toolRegistry.get("spacing")?.menuItems?.map((item) => item.toolId)).toEqual([
      "spacing",
      "kerning",
    ]);
  });
});
