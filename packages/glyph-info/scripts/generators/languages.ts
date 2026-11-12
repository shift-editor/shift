import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { load } from "js-yaml";
import type { Language } from "../../src/types.js";
import type {
  HyperglotAttribute,
  HyperglotLanguage,
  HyperglotOrthography,
  HyperglotOrthographyStatus,
} from "../types/hyperglot.js";

const INCLUDED_LANGUAGE_STATUSES = new Set(["living", "constructed"]);
const INCLUDED_VALIDITIES = new Set(["preliminary", "verified"]);
const ORTHOGRAPHY_STATUSES = new Set<HyperglotOrthographyStatus>([
  "primary",
  "secondary",
  "historical",
  "transliteration",
]);
const ATTRIBUTES = new Set<HyperglotAttribute>([
  "base",
  "auxiliary",
  "marks",
  "punctuation",
  "numerals",
  "currency",
]);
const REFERENCE_PATTERN = /<([^>]+)>/g;
/** A whole attribute that only points at another language's: `<arb>`. */
const WHOLE_REFERENCE = /^\s*<([^>\s]+)[^>]*>\s*$/;
const DOTTED_CIRCLE = 0x25cc;

/**
 * Writes every primary orthography of a living or constructed Hyperglot
 * language, with the language that covers it for type design.
 *
 * @remarks
 * Letters written as presentation forms (Hyperglot spells Pashto with
 * `ﺍ` U+FE8D, not `ا` U+0627) are normalized to the letters they show, since
 * fonts encode letters and shape the forms. Presentation-form blocks come
 * from Unicode's Blocks.txt.
 *
 * Format controls (ZWJ, ZWNJ: general category Cf) are left out: they shape
 * text but are not glyphs to draw.
 *
 * @param unicodeDir - folder holding Unicode's Blocks.txt and DerivedGeneralCategory.txt.
 */
export function generateLanguages(
  hyperglotPath: string,
  unicodeDir: string,
  outputPath: string,
): number {
  const dataPath = join(hyperglotPath, "lib", "hyperglot", "data");
  const presentationForms = presentationFormRanges(
    readFileSync(join(unicodeDir, "Blocks.txt"), "utf-8"),
  );
  const formatControls = formatControlRanges(
    readFileSync(join(unicodeDir, "DerivedGeneralCategory.txt"), "utf-8"),
  );
  const codepointsOf = (value: string) =>
    uniqueCodepoints(value, presentationForms).filter(
      (codepoint) => !inRanges(formatControls, codepoint),
    );
  const macrolanguages = parseMacrolanguages(
    join(hyperglotPath, "other", "hyperglot_macrolanguages.yaml"),
  );
  const languages = new Map<string, HyperglotLanguage>();

  for (const file of readdirSync(dataPath)
    .filter((entry) => entry.endsWith(".yaml"))
    .sort()) {
    const language = parseLanguage(join(dataPath, file));
    languages.set(basename(file, ".yaml"), language);
  }

  const scriptCodes = parseScriptCodes(
    join(hyperglotPath, "lib", "hyperglot", "extra_data", "script-names.yaml"),
  );

  languages.set(
    "default",
    parseLanguage(join(hyperglotPath, "lib", "hyperglot", "extra_data", "default.yaml")),
  );

  const generated: Language[] = [];
  /** Orthographies whose letters are only a reference to another language's, by id. */
  const copies = new Map<string, string>();
  for (const [languageCode, language] of languages) {
    if (languageCode === "default") continue;
    if (!INCLUDED_LANGUAGE_STATUSES.has(language.status ?? "living")) continue;
    if (!INCLUDED_VALIDITIES.has(language.validity ?? "todo")) continue;

    const primaryOrthographies = (language.orthographies ?? []).filter(
      (orthography) => (orthography.status ?? "primary") === "primary",
    );
    const scriptCounts = countScripts(primaryOrthographies);
    const scriptIndices = new Map<string, number>();

    for (const orthography of primaryOrthographies) {
      const base = resolveAttribute(languages, languageCode, orthography, "base", new Set());
      const codepoints = codepointsOf(base);
      if (codepoints.length === 0) continue;

      // A copy (`base: <dgo>`) is the same orthography, so it takes the marks and
      // punctuation it does not list from the language it copies.
      const copiedReference = WHOLE_REFERENCE.test(orthography.base ?? "")
        ? orthography.base
        : undefined;
      const inherited = {
        ...orthography,
        marks: orthography.marks ?? copiedReference,
        punctuation: orthography.punctuation ?? copiedReference,
      };
      const marks = resolveAttribute(languages, languageCode, inherited, "marks", new Set());
      const punctuation = resolveAttribute(
        languages,
        languageCode,
        inherited,
        "punctuation",
        new Set(),
      );

      const scriptIndex = (scriptIndices.get(orthography.script) ?? 0) + 1;
      scriptIndices.set(orthography.script, scriptIndex);
      const scriptSuffix = slugify(orthography.script);
      const duplicateSuffix =
        (scriptCounts.get(orthography.script) ?? 0) > 1 ? `-${scriptIndex}` : "";

      const id = `${languageCode}-${scriptSuffix}${duplicateSuffix}`;
      const copied = WHOLE_REFERENCE.exec(orthography.base ?? "")?.[1];
      if (copied) copies.set(id, copied);

      generated.push({
        id,
        name: language.preferred_name ?? language.name,
        autonym: orthography.autonym ?? null,
        script: orthography.script,
        scriptCode: scriptCode(scriptCodes, orthography.script),
        baseCodepoints: codepoints,
        markCodepoints: codepointsOf(marks),
        punctuationCodepoints: codepointsOf(punctuation),
        speakers: language.speakers ?? 0,
        coveredBy: null,
      });
    }
  }

  coverLanguages(generated, copies, macrolanguages);

  generated.sort(
    (left, right) =>
      left.script.localeCompare(right.script) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );

  const revision = execFileSync("git", ["-C", hyperglotPath, "rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).trim();
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        source: {
          name: "Hyperglot",
          url: "https://github.com/rosettatype/hyperglot",
          revision,
          license: "Apache-2.0",
        },
        languages: generated,
      },
      null,
      2,
    ),
  );

  return generated.length;
}

/** Reads Hyperglot's script names with their ISO 15924 codes. */
function parseScriptCodes(path: string): Map<string, string> {
  const parsed = load(readFileSync(path, "utf-8")) as Record<string, { iso_15924?: string }> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid Hyperglot script names: ${path}`);
  }
  const codes = new Map<string, string>();
  for (const [name, entry] of Object.entries(parsed)) {
    if (entry?.iso_15924) codes.set(name, entry.iso_15924);
  }
  return codes;
}

function scriptCode(codes: Map<string, string>, script: string): string {
  const code = codes.get(script);
  if (!code) throw new Error(`Hyperglot script without an ISO 15924 code: ${script}`);
  return code;
}

function parseLanguage(path: string): HyperglotLanguage {
  const parsed = load(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid Hyperglot language record: ${path}`);
  }

  return parsed as HyperglotLanguage;
}

function countScripts(orthographies: HyperglotOrthography[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const orthography of orthographies) {
    counts.set(orthography.script, (counts.get(orthography.script) ?? 0) + 1);
  }
  return counts;
}

function resolveAttribute(
  languages: Map<string, HyperglotLanguage>,
  languageCode: string,
  orthography: HyperglotOrthography,
  attribute: HyperglotAttribute,
  resolving: Set<string>,
): string {
  const value = orthography[attribute] ?? "";
  const resolutionKey = `${languageCode}:${orthography.script}:${orthography.status ?? "primary"}:${attribute}`;
  if (resolving.has(resolutionKey)) {
    throw new Error(`Circular Hyperglot inheritance: ${resolutionKey}`);
  }

  resolving.add(resolutionKey);
  const resolved = value.replace(REFERENCE_PATTERN, (_match, reference: string) =>
    resolveReference(languages, orthography, attribute, reference, resolving),
  );
  resolving.delete(resolutionKey);
  return resolved;
}

function resolveReference(
  languages: Map<string, HyperglotLanguage>,
  sourceOrthography: HyperglotOrthography,
  sourceAttribute: HyperglotAttribute,
  reference: string,
  resolving: Set<string>,
): string {
  const [languageCode, ...qualifiers] = reference.trim().split(/\s+/);
  if (!languageCode) return "";

  const language = languages.get(languageCode);
  if (!language) throw new Error(`Unknown Hyperglot inheritance target: ${languageCode}`);

  let attribute = sourceAttribute;
  let status: HyperglotOrthographyStatus | null = null;
  const scriptParts: string[] = [];

  for (const qualifier of qualifiers) {
    if (ATTRIBUTES.has(qualifier as HyperglotAttribute)) {
      attribute = qualifier as HyperglotAttribute;
      continue;
    }
    if (ORTHOGRAPHY_STATUSES.has(qualifier as HyperglotOrthographyStatus)) {
      status = qualifier as HyperglotOrthographyStatus;
      continue;
    }
    scriptParts.push(qualifier);
  }

  const script = scriptParts.join(" ");
  const candidates = language.orthographies ?? [];
  const target =
    candidates.find(
      (candidate) =>
        (script === "" || candidate.script === script) &&
        (status === null || (candidate.status ?? "primary") === status) &&
        candidate.script === sourceOrthography.script,
    ) ??
    candidates.find(
      (candidate) =>
        (script === "" || candidate.script === script) &&
        (status === null || (candidate.status ?? "primary") === status),
    );

  if (!target) throw new Error(`Unresolved Hyperglot inheritance target: <${reference}>`);

  return resolveAttribute(languages, languageCode, target, attribute, resolving);
}

function uniqueCodepoints(
  value: string,
  presentationForms: readonly (readonly [number, number])[],
): number[] {
  const codepoints = new Set<number>();
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined || codepoint === DOTTED_CIRCLE || /\s/u.test(character)) continue;

    const isPresentationForm = inRanges(presentationForms, codepoint);
    const letters = isPresentationForm ? character.normalize("NFKC") : character;
    for (const letter of letters) {
      const letterCodepoint = letter.codePointAt(0);
      if (letterCodepoint !== undefined && !/\s/u.test(letter)) codepoints.add(letterCodepoint);
    }
  }
  return codepoints
    .values()
    .toArray()
    .sort((left, right) => left - right);
}

function inRanges(ranges: readonly (readonly [number, number])[], codepoint: number): boolean {
  return ranges.some(([first, last]) => first <= codepoint && codepoint <= last);
}

/** The ranges of general category Cf (format), from DerivedGeneralCategory.txt. */
function formatControlRanges(text: string): [number, number][] {
  return text.split("\n").flatMap((line) => {
    const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*; Cf\b/.exec(line);
    if (!match?.[1]) return [];

    const first = Number.parseInt(match[1], 16);
    return [[first, match[2] ? Number.parseInt(match[2], 16) : first] as [number, number]];
  });
}

/** The ranges of Unicode's presentation-form blocks, from Blocks.txt. */
function presentationFormRanges(text: string): [number, number][] {
  return text.split("\n").flatMap((line) => {
    const match = /^([0-9A-F]+)\.\.([0-9A-F]+); .*Presentation Forms/.exec(line);
    if (!match?.[1] || !match[2]) return [];

    return [[Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)] as [number, number]];
  });
}

/** Each ISO 639-3 code a Hyperglot macrolanguage includes, with the macrolanguage's code. */
function parseMacrolanguages(path: string): Map<string, string> {
  const parsed = load(readFileSync(path, "utf-8")) as Record<string, { includes?: string[] }>;
  const macrolanguageOf = new Map<string, string>();
  for (const [macrolanguage, entry] of Object.entries(parsed ?? {})) {
    for (const code of entry?.includes ?? []) macrolanguageOf.set(code, macrolanguage);
  }
  return macrolanguageOf;
}

/**
 * Sets `coveredBy` on each orthography a font supporting another one supports
 * too, in two stages within a script:
 *
 * 1. Orthographies that are the same join one group: one's letters are a
 *    reference to the other's (`base: <arb>`), or their letters are identical.
 * 2. Groups whose heads belong to one macrolanguage join (Gulf and Standard
 *    Arabic). Judging by heads keeps a language that borrows another's
 *    alphabet from chaining its macrolanguage in: Qashqa'i writes with
 *    Persian's letters, but South Azerbaijani does not fold into Persian.
 *
 * Each group's most-spoken member covers the rest. Groups are unions, so
 * reference cycles cannot loop.
 */
function coverLanguages(
  languages: Language[],
  copies: ReadonlyMap<string, string>,
  macrolanguageOf: ReadonlyMap<string, string>,
): void {
  const code = (language: Language) => language.id.split("-")[0] ?? language.id;
  const byId = new Map(languages.map((language) => [language.id, language]));
  const byCodeAndScript = new Map(
    languages.map((language) => [`${code(language)}\u0000${language.script}`, language]),
  );
  const mostSpoken = (group: readonly Language[]) =>
    group.toSorted(
      (left, right) => right.speakers - left.speakers || left.id.localeCompare(right.id),
    )[0];

  const sameOrthography = new UnionFind(languages.map(({ id }) => id));
  const firstWithLetters = new Map<string, string>();
  for (const language of languages) {
    const copied = copies.get(language.id);
    const target = copied && byCodeAndScript.get(`${copied}\u0000${language.script}`);
    if (target) sameOrthography.join(language.id, target.id);

    const letters = `${language.script}\u0000${language.baseCodepoints.join(",")}`;
    const first = firstWithLetters.get(letters);
    if (first) sameOrthography.join(language.id, first);
    else firstWithLetters.set(letters, language.id);
  }

  const orthographyGroups = sameOrthography.groups(byId);
  const heads = orthographyGroups.flatMap((group) => mostSpoken(group) ?? []);
  const varieties = new UnionFind(heads.map(({ id }) => id));
  const firstInMacrolanguage = new Map<string, string>();
  for (const head of heads) {
    const macrolanguage = macrolanguageOf.get(code(head));
    if (!macrolanguage) continue;

    const key = `${head.script}\u0000${macrolanguage}`;
    const first = firstInMacrolanguage.get(key);
    if (first) varieties.join(head.id, first);
    else firstInMacrolanguage.set(key, head.id);
  }

  const coverOfHead = new Map<string, Language>();
  for (const group of varieties.groups(byId)) {
    const cover = mostSpoken(group);
    for (const head of group) if (cover) coverOfHead.set(head.id, cover);
  }
  for (const group of orthographyGroups) {
    const head = mostSpoken(group);
    const cover = head && coverOfHead.get(head.id);
    for (const language of group) {
      language.coveredBy = cover && cover !== language ? cover.id : null;
    }
  }
}

/** Disjoint sets of ids: joined ids share a root. */
class UnionFind {
  readonly #parent: Map<string, string>;

  constructor(ids: readonly string[]) {
    this.#parent = new Map(ids.map((id) => [id, id]));
  }

  join(left: string, right: string): void {
    this.#parent.set(this.#root(left), this.#root(right));
  }

  /** Each set, as the items its ids name. */
  groups<T>(items: ReadonlyMap<string, T>): T[][] {
    const groups = new Map<string, T[]>();
    for (const id of this.#parent.keys()) {
      const item = items.get(id);
      if (!item) continue;

      const root = this.#root(id);
      groups.set(root, [...(groups.get(root) ?? []), item]);
    }
    return [...groups.values()];
  }

  #root(id: string): string {
    let current = id;
    while (this.#parent.get(current) !== current) current = this.#parent.get(current) ?? current;
    return current;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
