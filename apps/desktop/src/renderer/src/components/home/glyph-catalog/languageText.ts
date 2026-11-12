import type { LanguageCoverage, LanguageScript } from "@shift/glyph-info";

/** The languages listed in their own right; the rest fold under one of them. */
export function listedLanguages(script: LanguageScript): LanguageCoverage[] {
  return script.languages.filter(({ language }) => language.coveredBy === null);
}

/**
 * Tracked ids with each folded language replaced by the one covering it, so a
 * font that tracks Algerian Arabic shows Standard Arabic ticked.
 */
export function listedIds(
  scripts: readonly LanguageScript[],
  trackedLanguageIds: readonly string[],
): string[] {
  const coverOf = new Map(
    scripts.flatMap(({ languages }) =>
      languages.map(({ language }) => [language.id, language.coveredBy ?? language.id] as const),
    ),
  );
  return [...new Set(trackedLanguageIds.map((id) => coverOf.get(id) ?? id))];
}

/** Every name a language row answers to in search: its own, its autonym, and what it covers. */
export function searchableNames({ language, covers, varieties }: LanguageCoverage): string[] {
  return [
    language.name,
    ...(language.autonym ? [language.autonym] : []),
    ...covers.map(({ name }) => name),
    ...varieties.map(({ language: variety }) => variety.name),
  ];
}

/**
 * A language row's tooltip: its full support, since the row counts only what
 * it adds beyond Basic, and the languages folded under it.
 */
export function languageTooltip({
  language,
  fullPresentCount,
  fullRequiredCount,
  covers,
  varieties,
}: LanguageCoverage): string {
  const lines = [
    ...(language.autonym ? [language.autonym] : []),
    `Supports ${language.name} fully: ${fullPresentCount}/${fullRequiredCount}`,
  ];
  if (covers.length > 0) lines.push(`Also covers ${covers.map(({ name }) => name).join(", ")}`);
  if (varieties.length > 0) {
    const listed = varieties.map(({ language: variety, extraCount }) => {
      return `${variety.name} (+${extraCount})`;
    });
    lines.push(`Varieties needing more: ${listed.join(", ")}`);
  }
  return lines.join("\n");
}
