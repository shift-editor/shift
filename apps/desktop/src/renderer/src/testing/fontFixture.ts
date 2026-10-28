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
import type { FontSessionMode } from "@shared/workspace/protocol";
import type { GlyphFixture } from "./fixtures";
import type { AxisFixture, AxisLocation, EditorTestSurface } from "./surface";
import { openTestEditor, startTestEditor } from "./TestEditor";

const FONTS_DIRECTORY = fileURLToPath(
  new URL("../../../../../../fixtures/fonts/", import.meta.url),
);

/** The font files in the repository's `fixtures/fonts` that tests open, by what they hold. */
export const FONTS = {
  /** MutatorSans as a designspace of four masters, with kerning. */
  mutatorSans: `${FONTS_DIRECTORY}mutatorsans-variable/MutatorSans.designspace`,
  /** MutatorSans's LightCondensed master on its own, as a UFO. */
  mutatorSansLightCondensed: `${FONTS_DIRECTORY}mutatorsans/MutatorSansLightCondensed.ufo`,
  /** Composites that take anchors from their components. */
  anchorPropagation: `${FONTS_DIRECTORY}AnchorPropagation.glyphs`,
  /** A weight axis whose user values map to other design values. */
  mappedWeight: `${FONTS_DIRECTORY}MappedWeight.glyphs`,
  /** Components scaled differently in each master. */
  scaledComponent: `${FONTS_DIRECTORY}ScaledComponent.glyphs`,
  /** Features that substitute and position glyphs, for shaping. */
  shapingTest: `${FONTS_DIRECTORY}ShapingTest.ufo`,
} as const;

/** One of {@link FONTS}. */
export type FontFile = (typeof FONTS)[keyof typeof FONTS];

/** A weight axis from 100 to 900, its default at 400. */
export const WEIGHT = { tag: "wght", minimum: 100, default: 400, maximum: 900 } as const;

/** A glyph a {@link FontFixture} adds, or draws into when the font already has it. */
export interface GlyphEntry {
  /** The glyph's Unicode value; none when omitted. Ignored for `A`, which every new font has. */
  readonly unicode?: number | null;
  /** What to draw into the glyph at the default source. */
  readonly outline?: GlyphFixture;
}

/**
 * The font a test starts from. A new font has one source, `Regular`, and one
 * glyph, `A` (U+0041), open.
 *
 * @remarks
 * It is built in this order:
 * 1. each of `glyphs`, in order: added unless the font has it, then opened and
 *    drawn when it has an `outline`;
 * 2. the glyph `open` is opened, `A` when omitted;
 * 3. each of `axes` is added;
 * 4. each of `sources` is added, in order. Each new source becomes the active
 *    one and gives the open glyph a layer there, so the last source is active
 *    when the test starts.
 */
export interface FontFixture {
  /** The editor's session capability; `workspace` when omitted. */
  readonly mode?: FontSessionMode;
  readonly glyphs?: Readonly<Record<string, GlyphEntry>>;
  /** The glyph open on the canvas when the test starts; `A` when omitted. */
  readonly open?: string;
  readonly axes?: readonly AxisFixture[];
  /** Sources to add, by name, at a location keyed by axis tag. */
  readonly sources?: Readonly<Record<string, AxisLocation>>;
  /** Never set: a fixture with a `file` is an {@link OpenFontFixture}. */
  readonly file?: never;
}

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

async function buildFont(editor: EditorTestSurface, fixture: FontFixture): Promise<void> {
  let open = "A";
  for (const [name, glyph] of Object.entries(fixture.glyphs ?? {})) {
    if (!editor.glyphNamed(name)) await editor.addGlyph(name, glyph.unicode ?? null);
    if (!glyph.outline) continue;
    if (open !== name) await editor.openGlyph(name);
    open = name;
    await editor.draw(glyph.outline);
  }

  const target = fixture.open ?? "A";
  if (open !== target) await editor.openGlyph(target);

  for (const axis of fixture.axes ?? []) await editor.addAxis(axis);
  for (const [name, location] of Object.entries(fixture.sources ?? {})) {
    await editor.addSource(name, location);
  }
}
