import type { FontFeature } from "@shift/editor/text";
import type { GlyphId } from "@shift/types";

/** A feature's setting in one text: the font's default, forced on, or forced off. */
export type FeatureSetting = "default" | "on" | "off";

/** One heading of the Features section and the features under it. */
export interface FeatureGroup {
  readonly title: string;
  readonly features: readonly FontFeature[];
}

/** A glyph a feature puts in the text, and every glyph sequence it replaces. */
export interface FeatureGlyph {
  readonly glyph: GlyphId;
  readonly replaces: readonly (readonly GlyphId[])[];
}

/** How the Features section shows one setting, and where a click on its dot moves it. */
export interface FeatureSettingStep {
  /** The setting a click moves to. */
  readonly next: FeatureSetting;
  /** The setting an Alt-click moves to. */
  readonly previous: FeatureSetting;
  /** What the run stores: `true` or `false` to force the feature, null for the font's default. */
  readonly override: boolean | null;
  /** The tooltip, given whether the font turns the feature on by default. */
  readonly label: (onByDefault: boolean) => string;
  /** The dot's colour class, given whether the font turns the feature on by default. */
  readonly dot: (onByDefault: boolean) => string;
}

/** A feature's glyphs, or why its substitutions could not be read (`error`, null when they were). */
export interface FeatureGlyphs {
  readonly glyphs: readonly FeatureGlyph[];
  readonly error: unknown;
}
