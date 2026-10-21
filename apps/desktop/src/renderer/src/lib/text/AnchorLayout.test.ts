import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnchorId, RunId } from "@shift/types";
import { effect } from "@shift/editor/signals";
import { PositionEdits } from "@shift/editor/model";
import type { TextLayout } from "@shift/editor/testing";
import { TestEditor } from "@/testing/TestEditor";

const SHAPING_TEST = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");

describe("a run's layout follows the anchors its marks and joins use, while one is dragged", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "beh-ar.init");
  });

  /** Opens a run and waits until the shaper has formed `names`. */
  async function shapedRun(text: string, names: string[]): Promise<RunId> {
    const runId = editor.text.createRun(editor.text.itemsFromText(text)).id;
    await expect
      .poll(() =>
        editor.text
          .layoutCell(runId)
          .peek()
          ?.placedGlyphs.map((placed) => placed.glyph.glyphName),
      )
      .toEqual(names);
    await editor.settle();
    return runId;
  }

  /** Previews a move of the edited `beh-ar.init`'s anchor, as a drag frame does. */
  function dragAnchor(name: string, delta: { x: number; y: number }) {
    const anchor = editor.requireGlyphLayer().anchors.find((candidate) => candidate.name === name)!;
    const selection = editor.positionSelection([anchor.id as AnchorId])!;
    const move = PositionEdits.fromSelection(selection).move(selection.targets);
    move.preview(delta);
    return move;
  }

  /** Holds the run's live layout the way the renderer does, collecting each one it sees. */
  function watchLayout(runId: RunId) {
    const layoutCell = editor.text.layoutCell(runId);
    const seen: TextLayout[] = [];
    const subscription = effect(() => {
      seen.push(layoutCell.value!);
    });
    return { layoutCell, seen, subscription };
  }

  it("keeps the layout when an anchor no mark or join uses moves", async () => {
    const runId = await shapedRun("ببب", ["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]);
    const { layoutCell, seen, subscription } = watchLayout(runId);

    const move = dragAnchor("top", { x: 30, y: 40 });
    const top = editor.requireGlyphLayer().anchors.find((anchor) => anchor.name === "top")!;
    subscription.dispose();

    expect(top).toMatchObject({ x: 230, y: 640 });
    expect(seen).toHaveLength(1);
    expect(layoutCell.peek()).toBe(seen[0]);
    move.discard();
  });

  it("moves a mark with the base anchor it attaches to", async () => {
    const runId = await shapedRun("بَب", ["beh-ar.fina", "fatha-ar", "beh-ar.init"]);
    const markX = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .placedGlyphs.find((placed) => placed.glyph.glyphName === "fatha-ar")!.origin.x;
    const { seen, subscription } = watchLayout(runId);
    const before = markX();

    const move = dragAnchor("top", { x: 30, y: 0 });
    subscription.dispose();

    expect(markX()).toBe(before + 30);
    expect(seen.length).toBeGreaterThan(1);
    move.discard();
  });

  it("re-steps a cursive join when the exit anchor moves", async () => {
    const runId = await shapedRun("\u0628\u0628\u0628", [
      "beh-ar.fina",
      "beh-ar.medi",
      "beh-ar.init",
    ]);
    const initHeight = () => editor.text.layoutCell(runId).peek()!.placedGlyphs.at(-1)!.origin.y;
    const { subscription } = watchLayout(runId);
    expect(initHeight()).toBe(400);

    const move = dragAnchor("exit", { x: 0, y: 10 });
    subscription.dispose();

    expect(initHeight()).toBe(390);
    move.discard();
  });
});
