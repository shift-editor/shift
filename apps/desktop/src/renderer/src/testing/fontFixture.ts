/**
 * Font fixtures: plain data describing the font a test starts from, and
 * {@link useTestEditor}, which builds one before each test and closes it after.
 *
 * @example
 * describe("dragging in a variable font", () => {
 *   const editor = useTestEditor({
 *     axes: [WEIGHT],
 *     sources: { Bold: { wght: 700 } },
 *     glyphs: { A: { outline: { contours: [square(100)] } } },
 *   });
 *
 *   it("moves the point in Bold", async () => {
 *     const [contour] = await editor.outline();
 *     …
 *   });
 * });
 *
 * @remarks
 * A fixture changes nothing until it is built, and it is built through the
 * same editor commands a test would call itself: {@link EditorTestSurface.addGlyph},
 * {@link EditorTestSurface.openGlyph}, {@link EditorTestSurface.draw},
 * {@link EditorTestSurface.addAxis} and {@link EditorTestSurface.addSource}.
 * Adding axes and sources is undoable like any edit, so undo only what the
 * test did.
 *
 * Building does not return point ids. A test that needs them draws its outline
 * itself, after the fixture has opened the glyph, and takes the names `draw` returns.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import { buildFont, FONT_FILES, WEIGHT, type FontFixture, type FontName } from "./fonts";
import type { EditorTestSurface } from "./surface";
import { openTestEditor, startTestEditor } from "./TestEditor";

const FONTS_DIRECTORY = fileURLToPath(
  new URL("../../../../../../fixtures/fonts/", import.meta.url),
);

/** The font files in the repository's `fixtures/fonts` that tests open, by what they hold, as absolute paths. */
export const FONTS = Object.fromEntries(
  Object.entries(FONT_FILES).map(([name, file]) => [name, `${FONTS_DIRECTORY}${file}`]),
) as { readonly [Name in FontName]: string };

/** One of {@link FONTS}. */
export type FontFile = (typeof FONTS)[FontName];

export { WEIGHT };
export type { FontFixture, GlyphEntry } from "./fonts";

/** A saved font file to open, with the glyph `glyph` open. */
export interface OpenFontFixture {
  readonly file: FontFile;
  readonly glyph: string;
}

/**
 * Starts an editor on the font `fixture` describes, or opens a font file, and
 * returns it.
 */
export async function startEditorWith(
  fixture: FontFixture | OpenFontFixture = {},
): Promise<EditorTestSurface> {
  if (fixture.file !== undefined) return openTestEditor(fixture.file, fixture.glyph);

  const editor = await startTestEditor(fixture.mode);
  await buildFont(editor, fixture);
  return editor;
}

/**
 * Starts an editor on `fixture` before each test in the enclosing `describe`
 * (or file) and closes it after.
 *
 * @returns the editor of the test that is running. Call it at module or
 * `describe` level; reading it outside a test throws.
 */
export function useTestEditor(fixture?: FontFixture | OpenFontFixture): EditorTestSurface {
  let current: EditorTestSurface | null = null;
  beforeEach(async () => {
    current = await startEditorWith(fixture);
  });
  afterEach(async () => {
    const editor = current;
    current = null;
    await editor?.close();
  });
  return new Proxy({} as EditorTestSurface, {
    get(_target, property) {
      if (!current) throw new Error("useTestEditor's editor exists only while a test runs");
      const value: unknown = Reflect.get(current, property, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}
