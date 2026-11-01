import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Font } from "@shift/editor/model";
import { signal } from "@shift/editor/signals";
import { typedTextItems } from "@shift/editor/text";
import {
  emptyExternalAxisLocation,
  externalAxisLocationFromRecord,
  type ExternalAxisLocation,
} from "@shift/editor/variation";
import type { GlyphName } from "@shift/types";
import { FONTS } from "@/testing/fontFixture";
import { createWorkspaceStack, openPreviewStack } from "@/testing/workspaceStack";

/** What closes after each test: previews, stacks and saved documents. */
const opened: (() => void)[] = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});

/** `sourcePath` opened as a preview window opens it; closed after the test. */
async function preview(sourcePath: string): Promise<Font> {
  const stack = await openPreviewStack(sourcePath);
  opened.push(() => stack.dispose());
  return stack.font;
}

/** `sourcePath` saved as a `.shift` document, and that document opened, as after Save As. */
async function savedDocument(sourcePath: string): Promise<Font> {
  const imported = createWorkspaceStack();
  opened.push(() => imported.dispose());
  await imported.openWorkspace(sourcePath);
  const directory = mkdtempSync(join(tmpdir(), "shift-preview-saved-"));
  opened.push(() => rmSync(directory, { recursive: true, force: true }));
  const documentPath = join(directory, "Saved.shift");
  await imported.editCoordinator.save(documentPath);

  const reopened = createWorkspaceStack();
  opened.push(() => reopened.dispose());
  await reopened.openWorkspace(documentPath);
  return reopened.font;
}

/** The names of the glyphs `text` lays out as, in display order, shaped as proof text is. */
function shaped(font: Font, text: string): (string | null)[] {
  const run = { items: typedTextItems(text), settings: { shaping: true, features: {} } };
  const placed = font.layoutText(run, emptyExternalAxisLocation(), null);
  if (!placed) return [];
  return placed.layout.glyphs.map(({ glyphId }) => (glyphId ? font.glyphName(glyphId) : null));
}

/** The location with each axis tagged in `values` at its value, in `font`'s axis ids. */
function at(font: Font, values: Record<string, number>): ExternalAxisLocation {
  const byId: Record<string, number> = {};
  for (const [tag, value] of Object.entries(values)) {
    const axis = font.axisTagged(tag);
    if (!axis) throw new Error(`the font has no ${tag} axis`);
    byId[axis.id] = value;
  }
  return externalAxisLocationFromRecord(byId);
}

/** The contours glyph `name` draws at `location`, each point with its id. */
async function drawn(font: Font, name: string, location: ExternalAxisLocation) {
  const entry = font.entryForName(name as GlyphName);
  if (!entry) throw new Error(`the font has no ${name}`);
  const glyph = await font.loadGlyph(entry.id);
  return glyph.renderModelAt(signal(location)).contours.map((contour) => ({
    id: contour.id,
    closed: contour.closed,
    points: contour.points.map(({ id, x, y }) => ({ id, x, y })),
  }));
}

describe("a preview's proof text shapes with the font's feature code", () => {
  it.each([
    ["a ligature", "fi", ["f_i"]],
    ["Arabic joining forms", "ببب", ["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]],
  ])("shapes %s, as an open document does", async (_case, typed, expected) => {
    const font = await preview(FONTS.shapingTest);

    expect(shaped(font, typed)).toEqual(expected);
  });
});

describe("a preview reads the font as the .shift it saves as", () => {
  it("draws a glyph at a mapped location exactly as the saved document", async () => {
    const [previewed, saved] = [
      await preview(FONTS.mappedWeight),
      await savedDocument(FONTS.mappedWeight),
    ];
    const outline = await drawn(previewed, "A", at(previewed, { wght: 600 }));

    expect(outline.length).toBeGreaterThan(0);
    expect(outline).toEqual(await drawn(saved, "A", at(saved, { wght: 600 })));
  });

  it("kerns a pair at a location exactly as the saved document", async () => {
    const [previewed, saved] = [
      await preview(FONTS.mutatorSans),
      await savedDocument(FONTS.mutatorSans),
    ];
    const kerning = (font: Font) => {
      const first = font.entryForName("T" as GlyphName);
      const second = font.entryForName("A" as GlyphName);
      if (!first || !second) throw new Error("MutatorSans has T and A");
      return font.kerningBetween(first.id, second.id, at(font, { wdth: 300, wght: 700 }), null);
    };

    expect(kerning(previewed)).not.toBe(0);
    expect(kerning(previewed)).toBe(kerning(saved));
  });
});
