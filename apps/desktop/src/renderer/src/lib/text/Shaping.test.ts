import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName, RunId } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
import { clusterForCaret, lineBreakTextItem } from "@shift/editor/text";
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
      clusterForCaret(editor.text.run(runId)!.items, editor.textEditing.state!.focus);

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

    const byPosition = layout()
      .placedGlyphs.toSorted((a, b) => a.left - b.left)
      .map((placed) => [placed.glyph.glyphName, placed.left]);
    expect(byPosition).toEqual([
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
      return layout().caretPosition(clusterForCaret(items, editor.textEditing.state!.focus)).x;
    };

    const xs = [caretX()];
    for (let press = 0; press < 4; press++) {
      editor.textEditing.move(-1, "word");
      xs.push(caretX());
    }

    expect(xs).toEqual([...xs].sort((a, b) => b - a));
    expect(new Set(xs).size).toBe(xs.length);
  });
});

describe("features can be turned on or off per proof text", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  it("lists the features the font's feature code defines", async () => {
    const tags = (await editor.font.features()).map((feature) => feature.tag);

    expect(tags).toEqual(["ccmp", "dlig", "fina", "init", "liga", "medi"]);
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
});

describe("editing feature code reshapes proof text", () => {
  it("follows a changed rule, and undo brings the old shaping back", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()
        ?.placedGlyphs.map((glyph) => glyph.glyph.glyphName) ?? [];
    await expect.poll(names).toEqual(["f_i"]);
    const original = await editor.font.featureSource();

    editor.history.capture("Edit Feature Code", () =>
      editor.font.setFeatureSource(
        "languagesystem DFLT dflt;\nfeature liga { sub i by f_i; } liga;\n",
      ),
    );
    await expect.poll(names).toEqual(["f", "f_i"]);

    await editor.undo();
    await expect.poll(names).toEqual(["f_i"]);
    expect(await editor.font.featureSource()).toBe(original);
  });
});

describe("glyph names generate features", () => {
  it("a new alternate's suffix adds its feature, and turning it on substitutes the alternate", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    expect((await editor.font.features()).map((feature) => feature.tag)).not.toContain("ss02");

    editor.history.capture("Add alternate", () => editor.font.createGlyph("f.ss02" as GlyphName));
    await editor.settle();

    expect((await editor.font.features()).map((feature) => feature.tag)).toContain("ss02");
    const runId = editor.text.createRun(editor.text.itemsFromText("f")).id;
    editor.history.capture("Set ss02", () => editor.text.setFeature(runId, "ss02", true));
    await expect
      .poll(() =>
        editor.text
          .layoutCell(runId)
          .peek()
          ?.placedGlyphs.map((g) => g.glyph.glyphName),
      )
      .toEqual(["f.ss02"]);
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

    expect(seen.filter((state) => state.names[0] === "f_i")).not.toContainEqual({
      names: ["f_i"],
      advance: 0,
    });
  });
});

describe("cursive attachment joins letters at their entry and exit anchors", () => {
  const heights = (editor: TestEditor, runId: RunId) =>
    (editor.text.layoutCell(runId).peek()?.placedGlyphs ?? []).map((glyph) => [
      glyph.glyph.glyphName,
      glyph.origin.y,
    ]);

  it("steps a right-to-left word down to the baseline at its last letter", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("ببب")).id;

    await expect
      .poll(() => heights(editor, runId))
      .toEqual([
        ["beh-ar.fina", 0],
        ["beh-ar.medi", 200],
        ["beh-ar.init", 400],
      ]);
    const lefts = editor.text
      .layoutCell(runId)
      .peek()!
      .placedGlyphs.map((glyph) => glyph.left);
    expect(lefts).toEqual([0, 450, 850]);
  });

  it("passes over a mark the font classes as one, giving it no advance", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("بٰب")).id;

    await expect
      .poll(() => heights(editor, runId))
      .toEqual([
        ["beh-ar.fina", 0],
        ["alefabove-ar", 0],
        ["beh-ar.init", 200],
      ]);
    const lefts = editor.text
      .layoutCell(runId)
      .peek()!
      .placedGlyphs.map((glyph) => glyph.left);
    expect(lefts).toEqual([0, 450, 450]);
  });

  it("follows an exit anchor while it is edited", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "beh-ar.init");
    const runId = editor.text.createRun(editor.text.itemsFromText("ببب")).id;
    await expect.poll(() => heights(editor, runId).at(-1)).toEqual(["beh-ar.init", 400]);

    const exit = editor.requireGlyphLayer().anchors.find((anchor) => anchor.name === "exit")!;
    editor.selection.select([exit.id]);
    editor.keyDown("ArrowUp", { shiftKey: true });

    await expect.poll(() => heights(editor, runId).at(-1)).toEqual(["beh-ar.init", 390]);
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
  it("sets a sidebearing on every edited glyph as one undo step", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    editor.history.capture("Set liga", () => editor.text.setFeature(run.runId, "liga", false));
    const [f] = editor.text.run(run.runId)!.items;
    editor.text.insertAfter(run.runId, f!.id, editor.text.itemsFromText("i"));
    const [, i] = editor.text.run(run.runId)!.items;
    const definition = editor.nodeDefinition("textRun");
    await expect.poll(() => editor.text.layoutCell(run.runId).peek()?.totalAdvance).toBe(550);
    editor.history.capture("Edit both", () => {
      const fNode = definition.editItem(run, f!.id)!;
      const iNode = definition.editItem(run, i!.id, 0, { add: true })!;
      editor.editing.set([fNode.id, iNode.id]);
    });
    const lsb = (name: string) =>
      editor
        .glyphForId(editor.font.recordForName(name as GlyphName)!.id)!
        .layerForSource(editor.font.defaultSource.id)!.sidebearings.lsb;

    editor.setLeftSidebearing(10);
    await editor.settle();
    expect([lsb("f"), lsb("i")]).toEqual([10, 10]);

    await editor.undo();
    expect([lsb("f"), lsb("i")]).toEqual([50, 50]);
  });

  it("draws the full metric box for the glyph being worked on and a baseline for the rest", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    editor.history.capture("Set liga", () => editor.text.setFeature(run.runId, "liga", false));
    const [f] = editor.text.run(run.runId)!.items;
    editor.text.insertAfter(run.runId, f!.id, editor.text.itemsFromText("i"));
    const [, i] = editor.text.run(run.runId)!.items;
    const definition = editor.nodeDefinition("textRun");
    await expect.poll(() => editor.text.layoutCell(run.runId).peek()?.totalAdvance).toBe(550);
    const fNode = definition.editItem(run, f!.id)!;
    const iNode = definition.editItem(run, i!.id, 0, { add: true })!;
    editor.editing.set([fNode.id, iNode.id]);
    const glyphs = editor.nodeDefinition("glyph");
    const boxes = () => [glyphs.showsMetrics(fNode), glyphs.showsMetrics(iNode)];

    expect(boxes()).toEqual([false, true]);

    const fPoint = editor.layerOf(fNode, editor.font.defaultSource.id)!.contours[0]!.points[0]!.id;
    editor.selection.select([fPoint]);
    expect(boxes()).toEqual([true, false]);
  });

  it("select all covers every edited glyph, and closing one keeps the other open", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const run = editor.textRun!;
    editor.history.capture("Set liga", () => editor.text.setFeature(run.runId, "liga", false));
    const [f] = editor.text.run(run.runId)!.items;
    editor.text.insertAfter(run.runId, f!.id, editor.text.itemsFromText("i"));
    const [, i] = editor.text.run(run.runId)!.items;
    const definition = editor.nodeDefinition("textRun");
    await expect.poll(() => editor.text.layoutCell(run.runId).peek()?.totalAdvance).toBe(550);
    let iNode = null as GlyphNode | null;
    editor.history.capture("Edit both", () => {
      const fNode = definition.editItem(run, f!.id)!;
      iNode = definition.editItem(run, i!.id, 0, { add: true })!;
      editor.editing.set([fNode.id, iNode.id]);
    });

    editor.selectAll();
    expect(editor.selection.ids).toHaveLength(8);

    editor.closeGlyphNode(iNode!.id);
    expect(definition.childGlyphs(run).map((child) => child.itemId)).toEqual([f!.id]);

    await editor.undo();
    expect(definition.childGlyphs(run)).toHaveLength(2);
  });
});

describe("switching a generated feature off", () => {
  it("stops it shaping proof text, and undo brings it back", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    editor.history.capture("Edit Feature Code", () => editor.font.setFeatureSource(null));
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()
        ?.placedGlyphs.map((glyph) => glyph.glyph.glyphName) ?? [];
    await expect.poll(names).toEqual(["f_i"]);

    editor.history.capture("Turn Off liga", () => editor.font.setGeneratedFeatureOn("liga", false));

    await expect.poll(names).toEqual(["f", "i"]);
    await editor.undo();
    await expect.poll(names).toEqual(["f_i"]);
  });
});
