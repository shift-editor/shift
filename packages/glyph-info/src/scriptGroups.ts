import { ascending, comparing } from "@shift/types";
import type {
  IndicPosition,
  RequiredGlyph,
  ScriptGroupDefinition,
  ScriptGroupInput,
  UnicodeProperties,
} from "./types.js";

/**
 * UAX #38's kUnihanCore2020 region sources, in the order the sidebar lists them.
 * The letters are Unicode's; the names are what each letter stands for.
 */
const UNIHAN_REGIONS = [
  ["G", "China"],
  ["T", "Taiwan"],
  ["H", "Hong Kong"],
  ["M", "Macao"],
  ["J", "Japan"],
  ["K", "South Korea"],
  ["P", "North Korea"],
] as const;

/** Vowel signs in reading order around the consonant: before, after, above, below. */
const INDIC_POSITION_ORDER: readonly (IndicPosition | null)[] = [
  "Left",
  "Right",
  "Top",
  "Bottom",
  null,
];

/**
 * The groups Unicode data defines for a script's tracked languages: Vowel
 * Signs (Indic), Punctuation, Mirrored (right-to-left scripts) and the Unihan
 * core sets (Han). Each is left out when it would be empty.
 */
export function unicodeGroups(input: ScriptGroupInput): ScriptGroupDefinition[] {
  const { script, languages } = input;
  const key = script.toLowerCase();
  const scriptCode = languages[0]?.scriptCode ?? "";
  const group = (slug: string, name: string, required: RequiredGlyph[]) =>
    required.length === 0 ? [] : [{ group: { id: `${key}/${slug}`, name, script }, required }];

  const punctuation = punctuationOf(input, scriptCode);
  return [
    ...group("vowel-signs", "Vowel Signs", vowelSigns(input)),
    ...group("punctuation", "Punctuation", punctuation.map(input.glyphFor)),
    ...group("mirrored", "Mirrored", mirrored(input, scriptCode, punctuation)),
    ...unihanCore(input).flatMap(([slug, name, required]) => group(slug, name, required)),
  ];
}

/**
 * Characters a language's casing rules map (Turkish İ and ı), from
 * SpecialCasing.txt; empty for a language without its own rules.
 *
 * @param languageId - Hyperglot orthography id, such as `tur-latin`.
 */
export function casingCharacters(
  unicode: UnicodeProperties,
  languageId: string,
): ReadonlySet<number> {
  const tag = languageTag(languageId);
  return new Set(tag ? (unicode.specialCasing[tag] ?? []) : []);
}

/** Orders vowel signs by where they sit: before, after, above, then below the consonant. */
const byReadingPosition = comparing(
  ({ position }: { position: IndicPosition | null }) => INDIC_POSITION_ORDER.indexOf(position),
  ascending,
);

/** Dependent vowel signs the languages use, before, after, above, then below the consonant. */
function vowelSigns({ languages, unicode, glyphFor }: ScriptGroupInput): RequiredGlyph[] {
  const used = new Set(
    languages.flatMap((language) => [...language.baseCodepoints, ...language.markCodepoints]),
  );
  return unicode.indic.vowelSigns
    .filter(({ codepoint }) => used.has(codepoint))
    .sort(byReadingPosition)
    .map(({ codepoint }) => glyphFor(codepoint));
}

/** The languages' punctuation and the script's own (Arabic ، ؛ ؟, Devanagari । ॥). */
function punctuationOf({ languages, unicode }: ScriptGroupInput, scriptCode: string): number[] {
  const punctuation = new Set([
    ...languages.flatMap((language) => language.punctuationCodepoints),
    ...(unicode.scriptPunctuation[scriptCode] ?? []),
  ]);
  return [...punctuation].sort(ascending);
}

/**
 * For a right-to-left script, the punctuation right-to-left text mirrors and
 * each one's partner, which the shaper shows in its place: `(` with `)`.
 */
function mirrored(
  { unicode, glyphFor }: ScriptGroupInput,
  scriptCode: string,
  punctuation: readonly number[],
): RequiredGlyph[] {
  if (!unicode.rightToLeftScripts.includes(scriptCode)) return [];

  const mirrorOf = new Map(unicode.mirrors.map(({ codepoint, mirror }) => [codepoint, mirror]));
  const characters = new Set<number>();
  for (const codepoint of punctuation) {
    const mirror = mirrorOf.get(codepoint);
    if (mirror === undefined) continue;

    characters.add(codepoint);
    characters.add(mirror);
  }
  return [...characters].sort(ascending).map(glyphFor);
}

/** Each Unihan core region's set, when the languages write Han characters. */
function unihanCore({
  languages,
  unicode,
  glyphFor,
}: ScriptGroupInput): [string, string, RequiredGlyph[]][] {
  const letters = languages.flatMap((language) => language.baseCodepoints);
  const core = new Set(Object.values(unicode.unihanCore).flat());
  if (!letters.some((letter) => core.has(letter))) return [];

  return UNIHAN_REGIONS.map(([source, region]) => [
    `core-${source.toLowerCase()}`,
    `Core: ${region}`,
    (unicode.unihanCore[source] ?? []).toSorted(ascending).map(glyphFor),
  ]);
}

/** The BCP 47 tag of a Hyperglot orthography id (`tur-latin` → `tr`), as SpecialCasing uses. */
function languageTag(languageId: string): string | null {
  const code = languageId.split("-")[0];
  if (!code) return null;

  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
}
