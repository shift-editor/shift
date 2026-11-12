import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/** A variable TrueType font with a weight axis, compiled deltas and no authored sources. */
const VARIABLE_TTF = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/fonts/HostGrotesk-VariableFont_wght.ttf",
);

/** Inter's variable TrueType font: `calt`, `kern` and stylistic sets in its own GSUB and GPOS. */
const INTER_TTF = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../packages/editor/src/ui/assets/fonts/Inter-VariableFont.ttf",
);

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

/**
 * The names of the glyphs `text` lays out as, in display order, shaped as
 * proof text is, with `features` turned on or off.
 */
function shaped(
  font: Font,
  text: string,
  features: Readonly<Record<string, boolean>> = {},
): (string | null)[] {
  const run = { items: typedTextItems(text), settings: { shaping: true, features } };
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
    id: contour.contour.id,
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

describe("a compiled font's preview evaluates its glyphs' deltas in its engine", () => {
  /** The bounds of every point `name` draws at `location`, off-curve points included. */
  async function pointBounds(font: Font, name: string, location: ExternalAxisLocation) {
    const points = (await drawn(font, name, location)).flatMap((contour) => contour.points);
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  it("draws a glyph's outline from its compiled deltas at a weight", async () => {
    const font = await preview(VARIABLE_TTF);
    const regular = await drawn(font, "a", font.designspace.defaultLocation());
    const bold = await drawn(font, "a", at(font, { wght: 800 }));

    expect(bold.map((contour) => contour.points.length)).toEqual(
      regular.map((contour) => contour.points.length),
    );
    expect(bold).not.toEqual(regular);
  });

  it("places a glyph's points at a mapped weight as fontTools' instancer does", async () => {
    const font = await preview(VARIABLE_TTF);
    const near = (bounds: readonly number[]) => bounds.map((value) => expect.closeTo(value, 3));

    // fontTools 4 `instantiateVariableFont(font, {"wght": …})`: the glyf
    // coordinates' bounds, through the font's avar at 550.
    expect(await pointBounds(font, "o", at(font, { wght: 550 }))).toEqual(
      near([26.35675, -12, 549.64325, 508]),
    );
    expect(await pointBounds(font, "o", at(font, { wght: 800 }))).toEqual(
      near([21, -12, 555, 508]),
    );
  });
});

describe("a compiled font's preview shapes proof text with the binary itself", () => {
  it("substitutes with the font's own GSUB unless a run turns the feature off", async () => {
    const font = await preview(INTER_TTF);

    expect(shaped(font, "->")).toEqual(["arrowright"]);
    expect(shaped(font, "->", { calt: false })).toEqual(["hyphen", "greater"]);
  });

  it("lists the features the font ships, for the Features section to toggle", async () => {
    const font = await preview(INTER_TTF);
    const tags = font.fontFeatures().map((feature) => feature.tag);

    expect(tags).toEqual(expect.arrayContaining(["calt", "kern", "ss01", "tnum"]));
  });

  it("kerns a pair by the font's own GPOS", async () => {
    const font = await preview(INTER_TTF);
    const width = (features: Readonly<Record<string, boolean>>) =>
      font.layoutText(
        { items: typedTextItems("AV"), settings: { shaping: true, features } },
        emptyExternalAxisLocation(),
        null,
      )?.layout.width;

    expect(width({})).toBeLessThan(width({ kern: false }) ?? 0);
  });
});
