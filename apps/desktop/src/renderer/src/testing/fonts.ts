/**
 * The font files tests open, shared by vitest and Playwright.
 *
 * @remarks
 * Paths are relative to the repository's `fixtures/fonts/`; each runner makes them absolute
 * (`FONTS` in `fontFixture.ts` for vitest, in `e2e/fixtures/electronApp.ts` for Playwright).
 * Playwright loads this file at runtime as CommonJS, so it has no runtime imports and uses
 * neither `import.meta.url` nor `__dirname`.
 */

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
