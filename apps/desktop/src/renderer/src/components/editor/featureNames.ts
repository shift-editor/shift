import type { FontFeature } from "@shift/editor/text";

/** Registered names for common features, shown when the font names none. */
const FEATURE_NAMES: Readonly<Record<string, string>> = {
  aalt: "Access All Alternates",
  abvm: "Above-base Mark Positioning",
  abvs: "Above-base Substitutions",
  afrc: "Alternative Fractions",
  akhn: "Akhand",
  blwf: "Below-base Forms",
  blwm: "Below-base Mark Positioning",
  blws: "Below-base Substitutions",
  c2sc: "Small Capitals From Capitals",
  calt: "Contextual Alternates",
  case: "Case-Sensitive Forms",
  ccmp: "Glyph Composition",
  cjct: "Conjunct Forms",
  clig: "Contextual Ligatures",
  cpsp: "Capital Spacing",
  curs: "Cursive Positioning",
  dist: "Distances",
  dlig: "Discretionary Ligatures",
  dnom: "Denominators",
  fina: "Terminal Forms",
  frac: "Fractions",
  half: "Half Forms",
  hist: "Historical Forms",
  init: "Initial Forms",
  isol: "Isolated Forms",
  kern: "Kerning",
  liga: "Standard Ligatures",
  ljmo: "Leading Jamo Forms",
  lnum: "Lining Figures",
  locl: "Localized Forms",
  mark: "Mark Positioning",
  medi: "Medial Forms",
  mkmk: "Mark to Mark Positioning",
  nukt: "Nukta Forms",
  numr: "Numerators",
  onum: "Oldstyle Figures",
  ordn: "Ordinals",
  pnum: "Proportional Figures",
  pref: "Pre-base Forms",
  pres: "Pre-base Substitutions",
  pstf: "Post-base Forms",
  psts: "Post-base Substitutions",
  rclt: "Required Contextual Alternates",
  rlig: "Required Ligatures",
  rphf: "Reph Form",
  salt: "Stylistic Alternates",
  sinf: "Scientific Inferiors",
  smcp: "Small Capitals",
  subs: "Subscript",
  sups: "Superscript",
  swsh: "Swash",
  titl: "Titling",
  tjmo: "Trailing Jamo Forms",
  tnum: "Tabular Figures",
  vatu: "Vattu Variants",
  vjmo: "Vowel Jamo Forms",
  zero: "Slashed Zero",
};

/** The name a feature is shown by: the font's, the registered one, or a numbered set's. */
export function featureName(feature: FontFeature): string | null {
  return feature.name ?? FEATURE_NAMES[feature.tag] ?? featureFamilyName(feature.tag);
}

/** Names numbered stylistic sets and character variants, such as "Stylistic Set 1". */
function featureFamilyName(tag: string): string | null {
  const number = Number.parseInt(tag.slice(2), 10);
  if (tag.startsWith("ss") && number > 0) return `Stylistic Set ${number}`;
  if (tag.startsWith("cv") && number > 0) return `Character Variant ${number}`;
  return null;
}
