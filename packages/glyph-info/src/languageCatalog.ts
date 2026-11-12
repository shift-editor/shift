import { alphabetical, comparing, orderBy } from "@shift/types";
import type { GlyphSets } from "./glyphSets.js";
import type {
  FontGlyph,
  Language,
  LanguageCatalog,
  LanguageCoverage,
  LanguageScript,
  RequiredGlyph,
  ScriptGroupCoverage,
  ScriptGroupDefinition,
} from "./types.js";

const byScript = comparing((script: LanguageScript) => script.script, alphabetical);
const byLanguageName = orderBy<LanguageCoverage>(
  comparing((coverage) => coverage.language.name, alphabetical),
  comparing((coverage) => coverage.language.id, alphabetical),
);

/**
 * Builds language and script-group coverage for one font.
 *
 * @param resolveName - maps a font glyph's name to its GlyphData name, so
 * `uni0628.init` counts as `beh-ar.init`.
 */
export function createLanguageCatalog(
  sets: GlyphSets,
  languages: readonly Language[],
  glyphs: readonly FontGlyph[],
  trackedLanguageIds: readonly string[],
  resolveName: (name: string, codepoint: number | null) => string,
): LanguageCatalog {
  const codepoints = new Set(glyphs.flatMap((glyph) => glyph.unicodes));
  const resolvedNames = glyphs.map((glyph) => resolveName(glyph.name, glyph.unicodes[0] ?? null));
  const names = new Set(resolvedNames);
  const has = (glyph: RequiredGlyph) =>
    (glyph.codepoint !== null && codepoints.has(glyph.codepoint)) || names.has(glyph.name);
  const presentCount = (required: readonly RequiredGlyph[]) =>
    required.reduce((count, glyph) => (has(glyph) ? count + 1 : count), 0);

  const languagesById = new Map(languages.map((language) => [language.id, language]));
  const languagesByScript = Map.groupBy(languages, (language) => language.script);
  const coveredBy = Map.groupBy(
    languages.filter((language) => language.coveredBy !== null),
    (language) => language.coveredBy,
  );
  /** How many glyphs a folded language needs beyond the language covering it. */
  const extraBeyondCover = (language: Language, cover: Language) => {
    const covered = new Set(sets.forLanguage(cover).map(({ name }) => name));
    return sets.forLanguage(language).filter(({ name }) => !covered.has(name)).length;
  };
  const basicNames = (script: string) =>
    new Set(sets.basicFor(script, languagesByScript.get(script) ?? []).map(({ name }) => name));
  const additions = (language: Language) => {
    const basic = basicNames(language.script);
    return sets.forLanguage(language).filter(({ name }) => !basic.has(name));
  };

  const foldedUnder = (language: Language) => {
    const folded = (coveredBy.get(language.id) ?? []).map((member) => ({
      language: member,
      extraCount: extraBeyondCover(member, language),
    }));
    return {
      covers: folded.filter(({ extraCount }) => extraCount === 0).map((entry) => entry.language),
      varieties: folded.filter(({ extraCount }) => extraCount > 0),
    };
  };

  const scripts = new Map<string, LanguageScript>();
  for (const language of languages) {
    const full = sets.forLanguage(language);
    const added = additions(language);
    const script = scripts.get(language.script) ?? {
      script: language.script,
      groups: [],
      languages: [],
    };
    script.languages.push({
      language,
      presentCount: presentCount(added),
      requiredCount: added.length,
      fullPresentCount: presentCount(full),
      fullRequiredCount: full.length,
      ...foldedUnder(language),
    });
    scripts.set(language.script, script);
  }

  const sortedScripts = scripts.values().toArray().sort(byScript);
  for (const script of sortedScripts) script.languages.sort(byLanguageName);

  const coverageById = new Map(
    sortedScripts.flatMap((script) =>
      script.languages.map((coverage) => [coverage.language.id, coverage] as const),
    ),
  );

  // A tracked language another one covers shows as the one covering it.
  const tracked = new Set(trackedLanguageIds.map((id) => languagesById.get(id)?.coveredBy ?? id));
  const groupRequired = new Map<string, RequiredGlyph[]>();
  const trackedScripts = sortedScripts.flatMap((script) => {
    const scriptLanguages = script.languages.filter(({ language }) => tracked.has(language.id));
    if (scriptLanguages.length === 0) return [];

    const key = script.script.toLowerCase();
    const basic = sets.basicFor(script.script, languagesByScript.get(script.script) ?? []);
    const basicGroup: ScriptGroupDefinition[] =
      basic.length === 0
        ? []
        : [
            {
              group: { id: `${key}/basic`, name: "Basic", script: script.script },
              required: basic,
            },
          ];
    const definitions = sets.groupsFor(
      script.script,
      scriptLanguages.map(({ language }) => language),
    );
    const shapesCount = definitions.filter(
      ({ group }) => group.id === `${key}/basic-shapes`,
    ).length;
    const groups = [
      ...definitions.slice(0, shapesCount),
      ...basicGroup,
      ...definitions.slice(shapesCount),
    ].map(({ group, required }): ScriptGroupCoverage => {
      groupRequired.set(group.id, required);
      return { group, presentCount: presentCount(required), requiredCount: required.length };
    });
    return [{ script: script.script, groups, languages: scriptLanguages }];
  });

  const required = (setId: string): RequiredGlyph[] => {
    const language = languagesById.get(setId);
    if (language) return additions(language);

    return groupRequired.get(setId) ?? [];
  };

  return {
    scripts: sortedScripts,
    trackedScripts,
    filter: (setId) => {
      const setGlyphs = required(setId);
      const setCodepoints = new Set(setGlyphs.flatMap(({ codepoint }) => codepoint ?? []));
      const setNames = new Set(setGlyphs.map(({ name }) => name));

      return glyphs.flatMap((glyph, index) => {
        const inSet =
          glyph.unicodes.some((unicode) => setCodepoints.has(unicode)) ||
          setNames.has(resolvedNames[index] ?? glyph.name);
        return inSet ? [glyph.name] : [];
      });
    },
    coverage: (languageId) => coverageById.get(languageId) ?? null,
    required,
    requiredFully: (languageId) => {
      const language = languagesById.get(languageId);
      return language ? sets.forLanguage(language) : [];
    },
    has,
  };
}
