import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { kerningValueEdit, type Font } from "@shift/editor/model";
import { createWorkspaceStack } from "@/testing/workspaceStack";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

// T then A kerns through T (a glyph) and A's second-position group at every
// master: LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.
async function openMutatorSans() {
  const stack = createWorkspaceStack();
  await stack.openWorkspace(MUTATOR_SANS);
  const font = stack.font;
  const id = (name: string) => font.recordForName(name as GlyphName)!.id;
  const source = (name: string) => font.sources.find((candidate) => candidate.name === name)!.id;
  return { stack, font, t: id("T"), a: id("A"), lightCondensed: source("LightCondensed") };
}

function kernAt(font: Font, sourceName: string, first: string, second: string): number {
  const sourceId = font.sources.find((candidate) => candidate.name === sourceName)!.id;
  const id = (name: string) => font.recordForName(name as GlyphName)!.id;
  return font.kerningBetween(id(first), id(second), font.defaultLocation(), sourceId);
}

// Behaviour through the editor lives in behaviour/kerning/kerning-edits.test.ts.
// This case checks the workspace edit coordinator itself: its undo shows at
// once, before the edit it undoes is persisted. The editor's undo waits for
// pending edits first (EditorHistory.undo), so no user path reaches this.
describe("the edit coordinator's kerning undo", () => {
  it("shows an undo right after an edit at once, before either is persisted", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    font.setKerningValues([kerningValueEdit(lightCondensed, pair, -90)], "Change kerning");
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);
    const undone = stack.editCoordinator.undo();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);

    await undone;
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });
});
