import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IndicPosition, UnicodeProperties } from "../../src/types.js";

const UCD_FILES = [
  "ArabicShaping.txt",
  "BidiMirroring.txt",
  "DerivedBidiClass.txt",
  "DerivedGeneralCategory.txt",
  "IndicPositionalCategory.txt",
  "IndicSyllabicCategory.txt",
  "PropertyValueAliases.txt",
  "ScriptExtensions.txt",
  "Scripts.txt",
  "SpecialCasing.txt",
  "Unihan_kUnihanCore2020.txt",
] as const;

/** Unicode general categories of punctuation: connector, dash, open, close, quotes, other. */
const PUNCTUATION_CATEGORIES = new Set(["Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po"]);
const INDIC_POSITIONS = new Set<string>(["Left", "Right", "Top", "Bottom"]);
const RIGHT_TO_LEFT_CLASSES = new Set(["R", "AL"]);
/** Scripts Unicode assigns to characters shared by many scripts, never a script of their own. */
const SHARED_SCRIPTS = new Set(["Zyyy", "Zinh", "Zzzz"]);

/** One data line of a UCD file: a codepoint or range, then its `;`-separated fields. */
interface UcdLine {
  first: number;
  last: number;
  fields: string[];
}

/**
 * Writes the Unicode properties glyph sets read, from vendored UCD files.
 *
 * @param unicodeDir - folder holding the files in {@link UCD_FILES}.
 * @returns how many characters each table holds.
 */
export function generateUnicode(unicodeDir: string, outputPath: string): Record<string, number> {
  const read = (file: (typeof UCD_FILES)[number]) => readFileSync(join(unicodeDir, file), "utf-8");
  const punctuation = ucdLines(read("DerivedGeneralCategory.txt")).flatMap(
    ({ first, last, fields }) =>
      PUNCTUATION_CATEGORIES.has(fields[0] ?? "") ? codepointsIn(first, last) : [],
  );

  const scriptCodes = scriptAliases(read("PropertyValueAliases.txt"));
  const scriptsOf = characterScripts(
    read("Scripts.txt"),
    read("ScriptExtensions.txt"),
    scriptCodes,
  );

  const properties: UnicodeProperties = {
    unihanCore: unihanCore(read("Unihan_kUnihanCore2020.txt")),
    specialCasing: specialCasing(read("SpecialCasing.txt")),
    mirrors: mirrors(read("BidiMirroring.txt")),
    joining: joining(read("ArabicShaping.txt")),
    rightToLeftScripts: rightToLeftScripts(read("DerivedBidiClass.txt"), scriptsOf),
    scriptPunctuation: scriptPunctuation(punctuation, scriptsOf),
    indic: indic(read("IndicSyllabicCategory.txt"), read("IndicPositionalCategory.txt")),
  };

  writeFileSync(
    outputPath,
    JSON.stringify({
      source: {
        name: "Unicode Character Database",
        files: UCD_FILES.map((file) => versionLine(read(file)) ?? file),
        license: "Unicode-3.0",
      },
      ...properties,
    }),
  );

  return {
    unihanCore: Object.values(properties.unihanCore).reduce((sum, list) => sum + list.length, 0),
    mirrors: properties.mirrors.length,
    rightToLeftScripts: properties.rightToLeftScripts.length,
    scriptPunctuation: Object.keys(properties.scriptPunctuation).length,
    indicConsonants: properties.indic.consonants.length,
  };
}

/** Each kUnihanCore2020 region source (G, H, J, K, M, P, T) and the characters it lists. */
function unihanCore(text: string): Record<string, number[]> {
  const regions: Record<string, number[]> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;

    const [hex, field, value] = line.split("\t");
    if (field !== "kUnihanCore2020" || !hex || !value) continue;

    const codepoint = Number.parseInt(hex.slice(2), 16);
    for (const region of value) (regions[region] ??= []).push(codepoint);
  }
  return regions;
}

/** For each language tag with special casing (tr, az, lt), every character its rules map. */
function specialCasing(text: string): Record<string, number[]> {
  const byLanguage: Record<string, Set<number>> = {};
  for (const { first, fields } of ucdLines(text, { rangeField: false })) {
    const [lower, title, upper, conditions] = fields;
    const tag = conditions?.split(" ").find((condition) => /^[a-z]{2,3}$/.test(condition));
    if (!tag) continue;

    const characters = (byLanguage[tag] ??= new Set());
    characters.add(first);
    for (const sequence of [lower, title, upper]) {
      for (const hex of sequence?.split(" ") ?? []) {
        if (hex) characters.add(Number.parseInt(hex, 16));
      }
    }
  }

  return Object.fromEntries(
    Object.entries(byLanguage).map(([tag, characters]) => [tag, [...characters]]),
  );
}

/** Letters that join their neighbours, and on which sides, from ArabicShaping.txt. */
function joining(text: string): UnicodeProperties["joining"] {
  return ucdLines(text, { rangeField: false }).flatMap(({ first, fields }) => {
    const type = fields[1];
    return type === "D" || type === "R" || type === "L" ? [{ codepoint: first, type }] : [];
  });
}

function mirrors(text: string): UnicodeProperties["mirrors"] {
  return ucdLines(text, { rangeField: false }).flatMap(({ first, fields }) => {
    const mirror = fields[0];
    return mirror ? [{ codepoint: first, mirror: Number.parseInt(mirror, 16) }] : [];
  });
}

/** Scripts whose letters are mostly right-to-left (bidi class R or AL). */
function rightToLeftScripts(
  bidiText: string,
  scriptsOf: (codepoint: number) => readonly string[],
): string[] {
  const counts = new Map<string, { rightToLeft: number; total: number }>();
  for (const { first, last, fields } of ucdLines(bidiText)) {
    const bidiClass = fields[0];
    if (!bidiClass || !["L", "R", "AL"].includes(bidiClass)) continue;

    for (let codepoint = first; codepoint <= last; codepoint += 1) {
      for (const script of scriptsOf(codepoint)) {
        const count = counts.get(script) ?? { rightToLeft: 0, total: 0 };
        count.total += 1;
        if (RIGHT_TO_LEFT_CLASSES.has(bidiClass)) count.rightToLeft += 1;
        counts.set(script, count);
      }
    }
  }

  return [...counts]
    .filter(([, { rightToLeft, total }]) => rightToLeft * 2 > total)
    .map(([script]) => script)
    .sort();
}

/** Punctuation each script uses as its own: its Script, or one of its Script_Extensions. */
function scriptPunctuation(
  punctuation: readonly number[],
  scriptsOf: (codepoint: number) => readonly string[],
): Record<string, number[]> {
  const byScript: Record<string, number[]> = {};
  for (const codepoint of [...punctuation].sort((left, right) => left - right)) {
    for (const script of scriptsOf(codepoint)) (byScript[script] ??= []).push(codepoint);
  }
  return byScript;
}

function indic(syllabicText: string, positionalText: string): UnicodeProperties["indic"] {
  const consonants: number[] = [];
  const viramas: number[] = [];
  const vowelSigns: number[] = [];
  for (const { first, last, fields } of ucdLines(syllabicText)) {
    const list = { Consonant: consonants, Virama: viramas, Vowel_Dependent: vowelSigns }[
      fields[0] ?? ""
    ];
    if (!list) continue;

    for (let codepoint = first; codepoint <= last; codepoint += 1) list.push(codepoint);
  }

  const positions: Record<number, IndicPosition> = {};
  for (const { first, last, fields } of ucdLines(positionalText)) {
    const position = fields[0];
    if (!position || !INDIC_POSITIONS.has(position)) continue;

    for (let codepoint = first; codepoint <= last; codepoint += 1) {
      positions[codepoint] = position as IndicPosition;
    }
  }

  return {
    consonants,
    viramas,
    vowelSigns: vowelSigns.map((codepoint) => ({
      codepoint,
      position: positions[codepoint] ?? null,
    })),
  };
}

/** Long script names (`Arabic`) to ISO 15924 codes (`Arab`). */
function scriptAliases(text: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [property, code, name] = line.split(";").map((field) => field.trim());
    if (property === "sc" && code && name) aliases.set(name, code);
  }
  return aliases;
}

/** A character's scripts as ISO codes: its Script_Extensions, or else its Script. */
function characterScripts(
  scriptsText: string,
  extensionsText: string,
  scriptCodes: ReadonlyMap<string, string>,
): (codepoint: number) => readonly string[] {
  const ranges = ucdLines(scriptsText).flatMap(({ first, last, fields }) => {
    const code = scriptCodes.get(fields[0] ?? "");
    return code && !SHARED_SCRIPTS.has(code) ? [{ first, last, codes: [code] }] : [];
  });
  const extensions = ucdLines(extensionsText).map(({ first, last, fields }) => ({
    first,
    last,
    codes: (fields[0] ?? "").split(" ").filter(Boolean),
  }));

  ranges.sort((left, right) => left.first - right.first);
  extensions.sort((left, right) => left.first - right.first);

  return (codepoint) => find(extensions, codepoint) ?? find(ranges, codepoint) ?? [];
}

/** The codes of the range holding a codepoint, by binary search over ranges sorted by start. */
function find(
  ranges: readonly { first: number; last: number; codes: string[] }[],
  codepoint: number,
): string[] | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (!range) return undefined;

    if (codepoint < range.first) high = middle - 1;
    else if (codepoint > range.last) low = middle + 1;
    else return range.codes;
  }
  return undefined;
}

/** Reads `0600..0604 ; Arabic` and `0628; 0629; ...` lines, without comments. */
function ucdLines(text: string, { rangeField = true } = {}): UcdLine[] {
  return text.split("\n").flatMap((line) => {
    const content = line.split("#")[0]?.trim();
    if (!content) return [];

    const [range, ...fields] = content.split(";").map((field) => field.trim());
    if (!range) return [];

    const [firstHex, lastHex] = rangeField ? range.split("..") : [range];
    const first = Number.parseInt(firstHex ?? "", 16);
    return [{ first, last: lastHex ? Number.parseInt(lastHex, 16) : first, fields }];
  });
}

function codepointsIn(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function versionLine(text: string): string | null {
  return text.match(/^# (\S+\.txt)/)?.[1] ?? null;
}
