/**
 * The font files tests open, shared by vitest and Playwright.
 *
 * @remarks
 * Paths are relative to the repository's `fixtures/fonts/`; each runner makes them absolute
 * (`FONTS` in `fontFixture.ts` for vitest, in `e2e/fixtures/electronApp.ts` for Playwright).
 * {@link buildFont} builds a {@link FontFixture} through either runner's editor: the vitest
 * surface or the Playwright driver. Playwright loads this file at runtime as CommonJS, so it
 * has type imports only and uses neither `import.meta.url` nor `__dirname`.
 */
import type { PointId } from "@shift/types";
import type { FontSessionMode } from "@shared/workspace/protocol";
import type { DrawOptions, GlyphFixture, PointNames } from "./fixtures";
import type { GlyphListing, Read } from "./reads";

/** The font files in the repository's `fixtures/fonts`, relative to it, by what they hold. */
export const FONT_FILES = {
  /** MutatorSans as a designspace of four masters, with kerning. */
  mutatorSans: "mutatorsans-variable/MutatorSans.designspace",
  /** MutatorSans's LightCondensed master on its own, as a UFO. */
  mutatorSansLightCondensed: "mutatorsans/MutatorSansLightCondensed.ufo",
  /** Composites that take anchors from their components. */
  anchorPropagation: "AnchorPropagation.glyphs",
  /** A weight axis whose user values map to other design values. */
  mappedWeight: "MappedWeight.glyphs",
  /** Components scaled differently in each master. */
  scaledComponent: "ScaledComponent.glyphs",
  /** Features that substitute and position glyphs, for shaping. */
  shapingTest: "ShapingTest.ufo",
  /** MutatorSans compiled to one static TrueType font, opened as a preview or imported. */
  mutatorSansTtf: "mutatorsans/MutatorSans.ttf",
  /** MutatorSans compiled to one static CFF OpenType font. */
  mutatorSansOtf: "mutatorsans/MutatorSans.otf",
  /** MutatorSans's masters as one Glyphs file, with a weight and a width axis. */
  mutatorSansGlyphs: "MutatorSansVariable.glyphs",
  /** A small font in the Glyphs package format, a `.glyphspackage` directory. */
  packageFont: "PackageFont.glyphspackage",
} as const;

/** The name of one of {@link FONT_FILES}. */
export type FontName = keyof typeof FONT_FILES;

/** A weight axis from 100 to 900, its default at 400. */
export const WEIGHT = { tag: "wght", minimum: 100, default: 400, maximum: 900 } as const;

/** A new continuous axis, as the Axes panel creates one. */
export interface AxisFixture {
  readonly tag: string;
  /** The axis's display name; its tag when omitted. */
  readonly name?: string;
  readonly minimum: number;
  readonly default: number;
  readonly maximum: number;
  /** Whether users see the axis; `external` when omitted. */
  readonly role?: "external" | "internal";
}

/**
 * A designspace location as each axis's user-facing value, keyed by axis tag;
 * unnamed axes sit at their default.
 */
export type AxisLocation = Readonly<Record<string, number>>;

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
 *    when the test starts;
 * 5. each source's `metrics` are set;
 * 6. each of `instances` is added;
 * 7. the editor moves to `location`, when set; it stays at the last source otherwise.
 *
 * It returns nothing: a test that needs an id reads it through the surface's selectors
 * (`source({ name })`, `axis({ tag })`, `instance({ name })`).
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
  /**
   * Metric positions to set, by source name (`Regular` for a new font's default source), then
   * metric name (`Ascender`, `Cap Height`, `x-Height`, `Baseline`, `Descender`).
   */
  readonly metrics?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Named instances to add, by name, at a location keyed by axis tag. */
  readonly instances?: Readonly<Record<string, AxisLocation>>;
  /** Where the editor is when the test starts, keyed by axis tag; the last source when omitted. */
  readonly location?: AxisLocation;
  /** Never set: a fixture with a `file` opens that file instead (vitest's `OpenFontFixture`). */
  readonly file?: never;
}

/**
 * What {@link buildFont} needs from an editor: the vitest surface's methods of the same names,
 * which the Playwright driver also provides.
 */
export interface FontBuilder {
  /** The glyph named `name`: its identity and the layer each source holds; null when the font has none. */
  glyphNamed(name: string): Read<GlyphListing | null>;
  /** Adds a glyph to the font and loads it. */
  addGlyph(name: string, unicode: number | null): Promise<void>;
  /** Opens the glyph named `name` on the canvas. */
  openGlyph(name: string): Promise<void>;
  /** Builds `fixture` into the open glyph and returns the ids of the points it names. */
  draw<const F extends GlyphFixture>(
    fixture: F,
    options?: DrawOptions,
  ): Promise<Record<PointNames<F>, PointId>>;
  /** Adds a variation axis, as the Create axis menu does, and waits for it. */
  addAxis(axis: AxisFixture): Promise<void>;
  /** Adds a source at `location`, as the Create source menu does, and waits for it. */
  addSource(name: string, location: AxisLocation): Promise<void>;
  /** Moves the metric named `metric` in the source `source` to `position`. */
  setSourceMetric(source: string, metric: string, position: number): Promise<void>;
  /** Adds a named instance at `location`, as Settings › Instances does. */
  addInstance(name: string, location: AxisLocation): Read<void>;
  /** Moves the editor to `location`, as the location sliders do. */
  setLocation(location: AxisLocation): Read<void>;
}

/**
 * Builds `fixture` into the font `editor` has open, in the order {@link FontFixture} describes.
 *
 * @remarks
 * Assumes `A` is the open glyph when it starts, as it is in a new vitest font: it opens a glyph
 * only to draw into it, or when `open` names another one.
 */
export async function buildFont(editor: FontBuilder, fixture: FontFixture): Promise<void> {
  let open = "A";
  for (const [name, glyph] of Object.entries(fixture.glyphs ?? {})) {
    if (!(await editor.glyphNamed(name))) await editor.addGlyph(name, glyph.unicode ?? null);
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
  for (const [source, metrics] of Object.entries(fixture.metrics ?? {})) {
    for (const [metric, position] of Object.entries(metrics)) {
      await editor.setSourceMetric(source, metric, position);
    }
  }
  for (const [name, location] of Object.entries(fixture.instances ?? {})) {
    await editor.addInstance(name, location);
  }
  if (fixture.location) await editor.setLocation(fixture.location);
}
