import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName, RunId, ShapeUnit } from "@shift/types";
import type { GlyphNode, TextRunNode } from "@shift/editor/types";
import { lineBreakTextItem, TextBuffer, type TextItem } from "@shift/editor/text";
import { effect } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

const SHAPING_TEST = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");

describe("proof text is shaped with the font's feature code", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const run = (text: string) => editor.text.createRun(editor.text.itemsFromText(text)).id;
  const placed = (runId: RunId) => editor.text.layoutCell(runId).peek()?.placedGlyphs ?? [];
  const names = (runId: RunId) => placed(runId).map((glyph) => glyph.glyph.glyphName);

  it("forms a ligature that covers both typed characters", async () => {
    const runId = run("fi");

    await expect.poll(() => names(runId)).toEqual(["f_i"]);
    const items = editor.text.run(runId)!.items.map((item) => item.id);
    expect(placed(runId)[0]!.glyph.sourceItemIds).toEqual(items);
  });

  it("joins Arabic into positional forms laid out right to left", async () => {
    const runId = run("ببب");

    await expect.poll(() => names(runId)).toEqual(["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]);
    const lefts = placed(runId).map((glyph) => glyph.left);
    expect(lefts).toEqual([0, 450, 850]);
  });

  it("places a mark on its base's anchor and a second mark on the first", async () => {
    const runId = run("بَّ");

    const raised = () => {
      const base = placed(runId).find((glyph) => glyph.glyph.glyphName === "beh-ar");
      const marks = placed(runId).filter((glyph) => glyph !== base);
      return marks
        .map((mark) => [mark.origin.x - (base?.origin.x ?? 0), mark.origin.y])
        .sort((a, b) => a[1]! - b[1]!);
    };

    await expect.poll(raised).toEqual([
      [350, 100],
      [350, 300],
    ]);
    expect(editor.text.layoutCell(runId).peek()!.totalAdvance).toBe(500);
  });
});

/** The unit the workspace shapes for an item; none for a line break. */
function shapeUnit(item: TextItem): ShapeUnit[] {
  if (item.kind === "character") return [{ codepoint: item.codepoint }];
  if (item.kind === "glyph") return [{ glyphId: item.glyphId }];

  return [];
}

describe("proof text shapes in the editor, as the workspace shapes it", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const run = (text: string) => editor.text.createRun(editor.text.itemsFromText(text)).id;
  const placed = (runId: RunId) => editor.text.layoutCell(runId).peek()?.placedGlyphs ?? [];
  const glyphIds = (runId: RunId) => placed(runId).map((glyph) => glyph.glyph.glyphId);

  /** The workspace's shaping of the same run, as glyph ids in the order a single-direction line shows them. */
  const workspaceGlyphIds = async (runId: RunId) => {
    const units = editor.text.run(runId)!.items.flatMap(shapeUnit);
    const [paragraph] = await editor.font.shapeParagraphs([{ units, location: { values: {} } }]);
    return paragraph!.runs.flatMap((shaped) => shaped.glyphs.map((glyph) => glyph.glyphId ?? null));
  };

  it.each([
    ["a ligature", "fi"],
    ["ligatures among spaces", "fi fifi f"],
    ["Arabic joining forms", "ببب بب"],
    ["marks on a base", "بَّ"],
  ])("shapes %s to the glyphs the workspace's shaper gives", async (_case, text) => {
    const runId = run(text);
    const expected = await workspaceGlyphIds(runId);

    await expect.poll(() => glyphIds(runId)).toEqual(expected);
  });

  it("shapes new text in the same tick once the shaper is ready", async () => {
    const ready = run("fi");
    await expect.poll(() => placed(ready).map((glyph) => glyph.glyph.glyphName)).toEqual(["f_i"]);

    const runId = run("fifi");

    expect(placed(runId).map((glyph) => glyph.glyph.glyphName)).toEqual(["f_i", "f_i"]);
  });
});

describe("double-clicking a character the font decomposes", () => {
  let editor: TestEditor;
  let runId: RunId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    runId = editor.textRun!.runId;
    const [first] = editor.text.run(runId)!.items;
    editor.text.insertAfter(runId, first!.id, editor.text.itemsFromText("\u0646"));
    await expect.poll(() => placedNamed("dotabove-ar")).not.toBeNull();
  });

  const placedNamed = (name: string) =>
    editor.text
      .layoutCell(runId)
      .peek()
      ?.placedGlyphs.find((placed) => placed.glyph.glyphName === name) ?? null;
  const doubleClickRun = async (x: number, y: number) => {
    const screen = editor.localToScreen({ x, y });
    await editor.click(screen.x, screen.y);
    await editor.click(screen.x, screen.y);
  };
  const glyphId = (name: string) => editor.font.recordForName(name as GlyphName)!.id;

  it("edits the body that was clicked and keeps drawing the dot", async () => {
    const body = placedNamed("noonDotless-ar")!;
    await doubleClickRun(body.origin.x + 250, 250);

    expect(editor.glyphIdOf(editor.runGlyph!)).toBe(glyphId("noonDotless-ar"));
    // The body is now the open glyph, so points are measured from its origin.
    const dot = placedNamed("dotabove-ar")!;
    const screen = editor.localToScreen({
      x: dot.origin.x - body.origin.x - 100,
      y: dot.origin.y - body.origin.y + 550,
    });
    editor.pointerMove(screen.x, screen.y);
    expect(editor.hover.id).toBe(dot.glyph.sourceItemIds[0]);
  });

  it("edits the dot when the dot is clicked", async () => {
    const dot = placedNamed("dotabove-ar")!;
    await doubleClickRun(dot.origin.x - 100, dot.origin.y + 550);

    expect(editor.glyphIdOf(editor.runGlyph!)).toBe(glyphId("dotabove-ar"));
  });
});

describe("carets in shaped text", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  /** Three joined behs: init (850–1250), medi (450–850), fina (0–450). */
  const threeBehs = async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("\u0628\u0628\u0628")).id;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(1250);
    return editor.text.layoutCell(runId).peek()!;
  };

  it("stands on the right edge before right-to-left text and the left edge after it", async () => {
    const layout = await threeBehs();

    expect([0, 1, 2, 3].map((cluster) => layout.caretPosition(cluster).x)).toEqual([
      1250, 850, 450, 0,
    ]);
  });

  it("lands on the nearest character boundary when right-to-left text is clicked", async () => {
    const layout = await threeBehs();

    expect(layout.caretAtPoint({ x: 1200, y: 0 })).toBe(0);
    expect(layout.caretAtPoint({ x: 100, y: 0 })).toBe(3);
  });

  it("splits a ligature between the characters it joins", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(550);

    expect(editor.text.layoutCell(runId).peek()!.caretPosition(1).x).toBe(275);
  });

  it("arrow keys follow the screen in right-to-left text", async () => {
    editor.selectTool("text");
    editor.textEditing.selectAll();
    editor.textEditing.insertText("ببب");
    const runId = editor.textRun!.runId;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(1250);
    const caret = () =>
      new TextBuffer(editor.text.run(runId)!.items, editor.textEditing.state!.focus).focusCluster;

    editor.textEditing.move(1, "character");
    expect(caret()).toBe(2);
    editor.textEditing.move(-1, "character");
    editor.textEditing.move(-1, "character");
    expect(caret()).toBe(3);
  });
});

describe("editing shaped text keeps untouched lines shaped", () => {
  it("pressing Enter leaves the line above joined while the new line waits", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    editor.selectTool("text");
    editor.textEditing.selectAll();
    editor.textEditing.insertText("\u0628\u0628");
    const runId = editor.textRun!.runId;
    const firstLine = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .lines[0]!.runs.flatMap((run) => run.glyphs.map((glyph) => glyph.glyphName));
    await expect.poll(firstLine).toEqual(["beh-ar.fina", "beh-ar.init"]);

    editor.textEditing.insert([lineBreakTextItem()]);

    expect(firstLine()).toEqual(["beh-ar.fina", "beh-ar.init"]);
  });
});

describe("turning shaping off lays a run out as typed", () => {
  it("shows the typed glyphs at once, and undo shapes the run again", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .placedGlyphs.map((placed) => placed.glyph.glyphName);
    await expect.poll(names).toEqual(["f_i"]);

    editor.history.capture("Turn shaping off", () => editor.text.setShaping(runId, false));
    expect(names()).toEqual(["f", "i"]);

    await editor.undo();
    await expect.poll(names).toEqual(["f_i"]);
  });
});

describe("mixed-direction paragraphs lay out by bidi level", () => {
  it("an Arabic paragraph places an English word to the left of the Arabic before it", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("بب fi")).id;
    const layout = () => editor.text.layoutCell(runId).peek()!;
    await expect.poll(() => layout().totalAdvance).toBe(1650);

    // Placed glyphs come left to right on screen, as shaping orders the runs.
    const onScreen = layout().placedGlyphs.map((placed) => [placed.glyph.glyphName, placed.left]);
    expect(onScreen).toEqual([
      ["f_i", 0],
      ["space", 550],
      ["beh-ar.fina", 800],
      ["beh-ar.init", 1250],
    ]);
    expect(layout().lineDirection(0)).toBe("rtl");
    expect(layout().caretPosition(0).x).toBe(1650);
  });
});

describe("Option-arrows in mixed-direction text", () => {
  it("only ever move left on screen through Arabic words inside English", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    editor.selectTool("text");
    editor.textEditing.selectAll();
    editor.textEditing.insertText("fi بب بب fi");
    const runId = editor.textRun!.runId;
    const layout = () => editor.text.layoutCell(runId).peek()!;
    await expect.poll(() => layout().lineDirection(0)).toBe("ltr");
    await expect.poll(() => layout().lines[0]!.runs.length).toBe(3);
    const caretX = () => {
      const items = editor.text.run(runId)!.items;
      return layout().caretPosition(
        new TextBuffer(items, editor.textEditing.state!.focus).focusCluster,
      ).x;
    };

    const xs = [caretX()];
    for (let press = 0; press < 4; press++) {
      editor.textEditing.move(-1, "word");
      xs.push(caretX());
    }

    const strictlyLeftward = xs.slice(1).every((x, press) => x < xs[press]!);
    expect(strictlyLeftward).toBe(true);
  });
});

describe("features can be turned on or off per proof text", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const features = () =>
    editor.text.featuresCell.peek().map((feature) => [feature.tag, feature.default]);

  it("lists the features the font's feature code defines, with the shaper's defaults", async () => {
    editor.text.createRun(editor.text.itemsFromText("fi"));

    await expect.poll(features).toEqual([
      ["ccmp", "required"],
      ["dlig", "off"],
      ["fina", "required"],
      ["init", "required"],
      ["liga", "on"],
      ["medi", "required"],
    ]);
  });

  it("keeps listing the features from each new shaper the text shapes with", async () => {
    editor.text.createRun(editor.text.itemsFromText("fi"));
    await expect.poll(() => features().length).toBe(6);
    const seen: string[][] = [];
    const watcher = effect(() => {
      seen.push(editor.text.featuresCell.value.map((feature) => feature.tag));
    });

    // A new glyph registers a new shaper; the list is read from it, not fetched once.
    await editor.addGlyph("g", 0x67);
    await editor.text.settled();
    watcher.dispose();

    expect(seen.at(-1)).toEqual(["ccmp", "dlig", "fina", "init", "liga", "medi"]);
  });

  it("turning liga off breaks the ligature and reset brings it back", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .placedGlyphs.map((placed) => placed.glyph.glyphName);
    await expect.poll(names).toEqual(["f_i"]);

    editor.history.capture("Set liga", () => editor.text.setFeature(runId, "liga", false));
    await expect.poll(names).toEqual(["f", "i"]);

    editor.history.capture("Reset features", () => editor.text.resetFeatures(runId));
    await expect.poll(names).toEqual(["f_i"]);
  });

  it("turning an off-by-default feature on applies it", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("ff")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .placedGlyphs.map((placed) => placed.glyph.glyphName);
    await expect.poll(() => editor.text.featuresCell.peek().length).toBe(6);
    expect(names()).toEqual(["f", "f"]);

    editor.history.capture("Set dlig", () => editor.text.setFeature(runId, "dlig", true));

    await expect.poll(names).toEqual(["f_i"]);
  });
});

describe("a substituted glyph appears only once it has loaded", () => {
  it("never shows the ligature before its outline and advance are there", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const layoutCell = editor.text.layoutCell(runId);
    const seen: { names: string[]; advance: number }[] = [];
    const watcher = effect(() => {
      const layout = layoutCell.value;
      if (!layout) return;
      seen.push({
        names: layout.placedGlyphs.map((placed) => placed.glyph.glyphName),
        advance: layout.totalAdvance,
      });
    });

    await expect.poll(() => seen.at(-1)?.names).toEqual(["f_i"]);
    watcher.dispose();

    expect(seen).not.toContainEqual({ names: ["f_i"], advance: 0 });
  });
});

describe("an edited glyph follows its item's shaping", () => {
  it("shows the ligature its item forms, drops the old glyph's selection, and returns", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const child = editor.runGlyph!;
    const runId = editor.textRun!.runId;
    const glyphId = (name: string) => editor.font.recordForName(name as GlyphName)!.id;
    const pointId = editor.requireGlyphLayer().contours[0]!.points[0]!.id;
    editor.selection.select([pointId]);

    editor.text.insertAfter(runId, child.itemId, editor.text.itemsFromText("i"));
    await expect.poll(() => editor.glyphIdOf(child)).toBe(glyphId("f_i"));

    expect(editor.runGlyph?.id).toBe(child.id);
    expect(editor.selection.ids).toEqual([]);

    editor.history.capture("Set liga", () => editor.text.setFeature(runId, "liga", false));
    await expect.poll(() => editor.glyphIdOf(child)).toBe(glyphId("f"));
  });
});

describe("editing several glyphs at once", () => {
  let editor: TestEditor;
  let run: TextRunNode;
  let fNode: GlyphNode;
  let iNode: GlyphNode;

  /** Lays out "fi" as two glyphs and edits both; setup, not the behavior under test. */
  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    run = editor.textRun!;
    editor.history.capture("Set liga", () => editor.text.setFeature(run.runId, "liga", false));
    const [f] = editor.text.run(run.runId)!.items;
    editor.text.insertAfter(run.runId, f!.id, editor.text.itemsFromText("i"));
    const [, i] = editor.text.run(run.runId)!.items;
    await expect.poll(() => editor.text.layoutCell(run.runId).peek()?.totalAdvance).toBe(550);
    const definition = editor.nodeDefinition("textRun");
    editor.history.capture("Edit both", () => {
      fNode = definition.editItem(run, f!.id)!;
      iNode = definition.editItem(run, i!.id, 0, { add: true })!;
      editor.editing.set([fNode.id, iNode.id]);
    });
  });

  const lsb = (name: string) =>
    editor
      .glyphForId(editor.font.recordForName(name as GlyphName)!.id)!
      .layerForSource(editor.font.defaultSource.id)!.sidebearings.lsb;
  const firstPoint = (node: GlyphNode) =>
    editor.layerOf(node, editor.font.defaultSource.id)!.contours[0]!.points[0]!.id;
  const children = () => editor.nodeDefinition("textRun").childGlyphs(run);

  it("sets a sidebearing on every edited glyph as one undo step", async () => {
    editor.setLeftSidebearing(10);
    await editor.settle();
    expect([lsb("f"), lsb("i")]).toEqual([10, 10]);

    await editor.undo();
    expect([lsb("f"), lsb("i")]).toEqual([50, 50]);
  });

  it("select all covers every edited glyph, and closing one keeps the other open", async () => {
    editor.selectAll();
    expect(editor.selection.ids).toHaveLength(8);

    editor.closeGlyphNode(iNode.id);
    expect(children().map((child) => child.id)).toEqual([fNode.id]);

    await editor.undo();
    expect(children()).toHaveLength(2);
  });

  it("keeps the other edited glyphs when a double-click cannot open its target", () => {
    // `f` shapes to one glyph, so it has no second part to edit.
    const opened = editor.nodeDefinition("textRun").editItem(run, fNode.itemId, 1);

    expect(opened).toBeNull();
    expect(children().map((child) => child.id)).toEqual([fNode.id, iNode.id]);
  });

  it("draws the full metric box for the glyph being worked on and a baseline for the rest", () => {
    const glyphs = editor.nodeDefinition("glyph");
    const seen: boolean[][] = [];
    // Read the way a render pass does, so a selection change must reach it.
    const pass = effect(() => {
      seen.push([glyphs.showsMetrics(fNode), glyphs.showsMetrics(iNode)]);
    });

    editor.selection.select([firstPoint(fNode)]);
    pass.dispose();

    expect(seen).toEqual([
      [false, true],
      [true, false],
    ]);
  });
});

describe("a slot whose glyph shaping removes", () => {
  it("shows no glyph once its item stops shaping to that many glyphs", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    editor.text.setItems(run.runId, editor.text.itemsFromText("\u0646"));
    const noon = editor.text.run(run.runId)!.items[0]!;
    await expect
      .poll(() => editor.text.layoutCell(run.runId).peek()?.partsOfItem(noon.id).length)
      .toBe(2);
    await editor.text.settled();
    const dot = editor.history.capture("Edit the dot", () =>
      editor.nodeDefinition("textRun").editItem(run, noon.id, 1),
    )!;
    expect(editor.glyphOf(dot)?.name).toBe("dotabove-ar");

    // Without ccmp, noon shapes to itself: one glyph, so the dot's slot is gone.
    editor.history.capture("Set ccmp", () => editor.text.setFeature(run.runId, "ccmp", false));

    await expect.poll(() => editor.glyphIdOf(dot)).toBeNull();
  });
});

describe("a glyph shaping swaps keeps the rest of the selection", () => {
  it("deselects only the points of the glyph that changed", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    // Load the medial form first, so the reshape below shows at once.
    const medial = editor.text.createRun(editor.text.itemsFromText("\u0628\u0628\u0628")).id;
    await expect
      .poll(() => editor.text.layoutCell(medial).peek()?.placedGlyphs[1]?.glyph.glyphName)
      .toBe("beh-ar.medi");
    editor.text.setItems(run.runId, editor.text.itemsFromText("\u0628\u0628"));
    const [first, second] = editor.text.run(run.runId)!.items;
    const names = () =>
      editor.text
        .layoutCell(run.runId)
        .peek()
        ?.placedGlyphs.map((placed) => placed.glyph.glyphName);
    await expect.poll(names).toEqual(["beh-ar.fina", "beh-ar.init"]);
    await editor.text.settled();
    const definition = editor.nodeDefinition("textRun");
    const [initNode, finaNode] = editor.history.capture("Edit both", () => {
      const nodes = [
        definition.editItem(run, first!.id)!,
        definition.editItem(run, second!.id, 0, { add: true })!,
      ];
      editor.editing.set(nodes.map((node) => node.id));
      return nodes;
    });
    const point = (node: GlyphNode) =>
      editor.layerOf(node, editor.font.defaultSource.id)!.contours[0]!.points[0]!.id;
    const kept = point(initNode!);
    editor.selection.select([kept, point(finaNode!)]);

    // A third beh turns the second one's final form into a medial one.
    editor.text.insertAfter(run.runId, second!.id, editor.text.itemsFromText("\u0628"));
    await expect.poll(() => editor.glyphOf(finaNode!)?.name).toBe("beh-ar.medi");

    expect(editor.selection.ids).toEqual([kept]);
  });
});

describe("a picked glyph the shaper answers with no glyph", () => {
  it("still shows, and opens, the glyph picked", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    // The shaper maps .notdef to no glyph; the pick names it all the same.
    editor.text.setItems(run.runId, editor.text.itemsFromText("/.notdef"));
    const pick = editor.text.run(run.runId)!.items[0]!;
    await expect.poll(() => editor.text.featuresCell.peek().length).toBeGreaterThan(0);
    const layout = editor.text.layoutCell(run.runId).peek()!;

    expect(layout.partsOfItem(pick.id).map((placed) => placed.glyph.glyphName)).toEqual([
      ".notdef",
    ]);
    expect(layout.totalAdvance).toBe(500);
    const opened = editor.history.capture("Open", () =>
      editor.nodeDefinition("textRun").editItem(run, pick.id),
    );
    expect(opened && editor.glyphOf(opened)?.name).toBe(".notdef");
  });
});

describe("marks the font classes as marks", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const placed = (runId: RunId) =>
    (editor.text.layoutCell(runId).peek()?.placedGlyphs ?? []).map((glyph) => [
      glyph.glyph.glyphName,
      glyph.left,
      glyph.glyph.xAdvance,
    ]);

  it("give a nonspacing mark no advance, though it has no anchor to attach by", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("\u0628\u0670\u0628")).id;

    await expect
      .poll(() => placed(runId))
      .toEqual([
        ["beh-ar.fina", 0, 450],
        ["alefabove-ar", 450, 0],
        ["beh-ar.init", 450, 400],
      ]);
  });

  // `tick` is classed as a mark but glyph data does not make it a nonspacing one, so export keeps its width.
  it("keep a spacing mark's width", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("i/tick/i")).id;

    await expect
      .poll(() => placed(runId))
      .toEqual([
        ["i", 0, 250],
        ["tick", 250, 200],
        ["i", 450, 250],
      ]);
  });
});
