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
const DOTTED_CIRCLE = 0x25cc;

export function generateLanguages(hyperglotPath: string, outputPath: string): number {
  const dataPath = join(hyperglotPath, "lib", "hyperglot", "data");
  const languages = new Map<string, HyperglotLanguage>();

  for (const file of readdirSync(dataPath)
    .filter((entry) => entry.endsWith(".yaml"))
    .sort()) {
    const language = parseLanguage(join(dataPath, file));
    languages.set(basename(file, ".yaml"), language);
  }

  languages.set(
    "default",
    parseLanguage(join(hyperglotPath, "lib", "hyperglot", "extra_data", "default.yaml")),
  );

  const generated: Language[] = [];
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
      const codepoints = uniqueCodepoints(base);
      if (codepoints.length === 0) continue;

      const scriptIndex = (scriptIndices.get(orthography.script) ?? 0) + 1;
      scriptIndices.set(orthography.script, scriptIndex);
      const scriptSuffix = slugify(orthography.script);
      const duplicateSuffix =
        (scriptCounts.get(orthography.script) ?? 0) > 1 ? `-${scriptIndex}` : "";

      generated.push({
        id: `${languageCode}-${scriptSuffix}${duplicateSuffix}`,
        name: language.preferred_name ?? language.name,
        autonym: orthography.autonym ?? null,
        script: orthography.script,
        baseCodepoints: codepoints,
      });
    }
  }

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

function uniqueCodepoints(value: string): number[] {
  const codepoints = new Set<number>();
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined || codepoint === DOTTED_CIRCLE || /\s/u.test(character)) continue;
    codepoints.add(codepoint);
  }
  return [...codepoints].sort((left, right) => left - right);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
