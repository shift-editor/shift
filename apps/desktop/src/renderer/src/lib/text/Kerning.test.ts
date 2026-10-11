import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { glyphTextItem } from "@shift/editor/text";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import type { Font } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";
import { createWorkspaceStack } from "@/testing/workspaceStack";

const FIXTURES = resolve(process.cwd(), "../../fixtures/fonts");
const MUTATOR_SANS = resolve(FIXTURES, "mutatorsans-variable/MutatorSans.designspace");

// T followed by A resolves through A's second-position group at every master:
// LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.
function glyphId(font: Font, name: string) {
  const record = font.recordForName(name as GlyphName);
  if (!record) throw new Error(`fixture has no ${name}`);
  return record.id;
}

function sourceId(font: Font, name: string) {
  const source = font.sources.find((candidate) => candidate.name === name);
  if (!source) throw new Error(`fixture has no ${name} source`);
  return source.id;
}

function location(font: Font, width: number, weight: number) {
  const axis = (tag: string) => font.axesCell.peek().find((candidate) => candidate.tag === tag)!.id;
  return externalAxisLocationFromRecord({
    [axis("wdth")]: width,
    [axis("wght")]: weight,
  });
}

describe("kerning between glyphs", () => {
  it("reads each master's own pairs", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
    const font = stack.font;
    const t = glyphId(font, "T");
    const a = glyphId(font, "A");

    expect(font.kerningBetween(t, a, font.defaultLocation(), null)).toBe(-75);
    expect(font.kerningBetween(t, a, location(font, 1000, 0), null)).toBe(-215);
    expect(font.kerningBetween(t, a, font.defaultLocation(), sourceId(font, "BoldWide"))).toBe(
      -150,
    );
  });

  it("blends the masters between them, including on a support layer without kerning", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
    const font = stack.font;
    const t = glyphId(font, "T");
    const a = glyphId(font, "A");

    expect(font.kerningBetween(t, a, location(font, 500, 500), null)).toBeCloseTo(-126.25);
    // The crossbar support layer sits at weight 700 and authors no pairs.
    expect(font.kerningBetween(t, a, location(font, 0, 700), null)).toBeCloseTo(-68);
  });

  it("uses the only source of a static font", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(resolve(FIXTURES, "mutatorsans/MutatorSansLightCondensed.ufo"));
    const font = stack.font;

    expect(
      font.kerningBetween(glyphId(font, "T"), glyphId(font, "A"), font.defaultLocation(), null),
    ).toBe(-75);
    expect(
      font.kerningBetween(glyphId(font, "A"), glyphId(font, "T"), font.defaultLocation(), null),
    ).toBe(0);
  });
});

describe("kerning in a text run", () => {
  async function kernedRun() {
    const editor = new TestEditor();
    await editor.openSession(MUTATOR_SANS, "T");
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    editor.escape();
    await editor.settle();
    const run = editor.textRun!;
    const layoutCell = editor.text.layoutCell(run.runId);
    const placed = () => layoutCell.peek()!.placedGlyphs;
    return { editor, run, placed };
  }

  it("moves the second glyph by the pair's kerning and keeps advances intact", async () => {
    const { placed } = await kernedRun();
    const [t, a] = placed();

    expect(t!.glyph.xKern).toBe(-75);
    expect(a!.glyph.xKern).toBe(0);
    expect(a!.left).toBe(t!.left + t!.glyph.xAdvance - 75);
  });

  it("follows the active source", async () => {
    const { editor, placed } = await kernedRun();

    editor.selectSource(sourceId(editor.font, "BoldWide"));

    const [t, a] = placed();
    expect(t!.glyph.xKern).toBe(-150);
    expect(a!.left).toBe(t!.left + t!.glyph.xAdvance - 150);
  });

  it("measures each sidebearing to its own advance edge, leaving the kerning between them", async () => {
    const { editor, run, placed } = await kernedRun();
    const [t, a] = placed();

    const gap = editor.nodeDefinition("textRun").spacingGaps(run)[1]!;

    expect(gap.leftBoundary).toBe(t!.left + t!.glyph.xAdvance);
    expect(gap.rightBoundary).toBe(a!.left);
    expect(gap.rightBoundary - gap.leftBoundary).toBe(-75);
  });
});
