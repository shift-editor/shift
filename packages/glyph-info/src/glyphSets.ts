import { alphabetical, ascending, comparing, orderBy } from "@shift/types";
import type {
  FontGlyph,
  Glyph,
  GlyphPosition,
  Language,
  LetterSkeleton,
  LanguageCatalog,
  LanguageCoverage,
  LanguageScript,
  RequiredGlyph,
  ScriptGroup,
  ScriptGroupCoverage,
} from "./types.js";

/** Ligatures a script's shaping always forms, so its languages require them: Arabic's lam-alef. */
const REQUIRED_LIGATURES: ReadonlyMap<string, RegExp> = new Map([
  ["arabic", /^lam_alef(?!Maksura)/],
]);

/**
 * Scripts whose unencoded letters are locale alternates (`idotaccent`,
 * `Jacute`), not forms shaping needs, so their languages require none.
 */
const ALTERNATE_FORM_SCRIPTS: ReadonlySet<string> = new Set(["latin", "cyrillic", "greek"]);

const POSITIONS: ReadonlySet<string> = new Set<GlyphPosition>(["init", "medi", "fina"]);
const UNI_SEQUENCE = /^uni((?:[0-9A-Fa-f]{4})+)$/;
const U_SCALAR = /^u([0-9A-Fa-f]{5,6})$/;

/** An unencoded GlyphData glyph and the characters it shapes. */
interface Form {
  readonly glyph: Glyph;
  readonly characters: readonly number[];
  readonly position: GlyphPosition | null;
  /** A ligature of several letters, rather than one letter's form. */
  readonly ligature: boolean;
  /** Needed wherever its letters are: a letter's form, or a ligature such as Arabic's lam-alef. */
  readonly required: boolean;
}

interface GroupDefinition {
  readonly group: ScriptGroup;
  readonly required: RequiredGlyph[];
}

const byScript = comparing((script: LanguageScript) => script.script, alphabetical);
const byLanguageName = orderBy<LanguageCoverage>(
  comparing((coverage) => coverage.language.name, alphabetical),
  comparing((coverage) => coverage.language.id, alphabetical),
);

/**
 * The glyphs languages and script groups require, by glyph name.
 *
 * @remarks
 * A language requires its Hyperglot base characters and every unencoded
 * GlyphData letter form in its script built only from its characters and
 * marks: Arabic `.init`/`.medi`/`.fina` forms, Indic half forms, and ligatures
 * the script always forms. Optional ligatures go to the script's Ligatures
 * group; isolated forms and stylistic alternates are left out.
 */
export class GlyphSets {
  readonly #formsByScript: ReadonlyMap<string, readonly Form[]>;
  readonly #nameFor: (codepoint: number) => string;
  readonly #skeletons: ReadonlyMap<number, number>;
  // non-reactive: memoizes immutable reference data, never read by computed/effects.
  readonly #requiredByLanguage = new Map<string, RequiredGlyph[]>();

  /**
   * @param glyphs - every GlyphData entry, encoded or not.
   * @param codepointFor - resolves a GlyphData, production or alternate name to its codepoint.
   * @param nameFor - names a character's glyph.
   * @param skeletons - each joining-script letter's dotless skeleton, from Unicode.
   */
  constructor(
    glyphs: readonly Glyph[],
    codepointFor: (name: string) => number | null,
    nameFor: (codepoint: number) => string,
    skeletons: readonly LetterSkeleton[],
  ) {
    this.#nameFor = nameFor;
    this.#skeletons = new Map(skeletons.map(({ codepoint, skeleton }) => [codepoint, skeleton]));
    const formsByScript = new Map<string, Form[]>();
    for (const glyph of glyphs) {
      const form = formOf(glyph, codepointFor);
      if (!form || !glyph.script) continue;

      const forms = formsByScript.get(glyph.script) ?? [];
      forms.push(form);
      formsByScript.set(glyph.script, forms);
    }

    this.#formsByScript = formsByScript;
  }

  /** Every glyph the language requires: its characters with their forms, then other forms. */
  forLanguage(language: Language): RequiredGlyph[] {
    const cached = this.#requiredByLanguage.get(language.id);
    if (cached) return cached;

    const available = new Set([...language.baseCodepoints, ...language.markCodepoints]);
    const forms = this.#forms(language.script).filter(
      (form) => form.required && within(form.characters, available),
    );
    const required = this.#ordered(language.baseCodepoints, forms);
    this.#requiredByLanguage.set(language.id, required);
    return required;
  }

  /**
   * The script groups shown beside a script's tracked languages.
   *
   * @param script - Hyperglot script name, such as `Arabic`.
   * @param languages - the script's tracked languages; their letters bound both groups.
   */
  groupsFor(script: string, languages: readonly Language[]): GroupDefinition[] {
    const key = scriptKey(script);
    const groups: GroupDefinition[] = [];

    const shapes = this.#basicShapes(languages);
    if (shapes.length > 0) {
      const shapeSet = new Set(shapes);
      const forms = this.#forms(script).filter(
        (form) => form.required && within(form.characters, shapeSet),
      );
      groups.push({
        group: { id: `${key}/basic-shapes`, name: "Basic Shapes", script },
        required: this.#ordered(shapes, forms),
      });
    }

    const available = new Set(
      languages.flatMap((language) => [...language.baseCodepoints, ...language.markCodepoints]),
    );
    const ligatures = this.#forms(script).filter(
      (form) => form.ligature && within(form.characters, available),
    );
    if (ligatures.length > 0) {
      groups.push({
        group: { id: `${key}/ligatures`, name: "Ligatures", script },
        required: ligatures.map(requiredForm),
      });
    }

    return groups;
  }

  /**
   * The dotless skeletons the languages' letters are drawn on, such as dotless
   * beh for beh, teh and theh; empty when no letter adds dots to a skeleton,
   * so scripts without dotted letters get no Basic Shapes group.
   */
  #basicShapes(languages: readonly Language[]): number[] {
    const letters = new Set(languages.flatMap((language) => language.baseCodepoints));
    const shapes = new Set<number>();
    let dotted = false;
    for (const letter of letters) {
      const skeleton = this.#skeletons.get(letter);
      if (skeleton === undefined) continue;

      shapes.add(skeleton);
      if (skeleton !== letter) dotted = true;
    }

    return dotted ? [...shapes] : [];
  }

  #forms(script: string): readonly Form[] {
    return this.#formsByScript.get(scriptKey(script)) ?? [];
  }

  /** Each character followed by its own forms, then forms of several characters. */
  #ordered(codepoints: readonly number[], forms: readonly Form[]): RequiredGlyph[] {
    const formsByCharacter = new Map<number, Form[]>();
    const compound: Form[] = [];
    for (const form of forms) {
      const [character] = form.characters;
      if (form.characters.length !== 1 || character === undefined) {
        compound.push(form);
        continue;
      }

      const own = formsByCharacter.get(character) ?? [];
      own.push(form);
      formsByCharacter.set(character, own);
    }

    const required: RequiredGlyph[] = [];
    for (const codepoint of [...new Set(codepoints)].sort(ascending)) {
      required.push({
        name: this.#nameFor(codepoint),
        codepoint,
        characters: [codepoint],
        position: null,
      });
      for (const form of formsByCharacter.get(codepoint) ?? []) required.push(requiredForm(form));
    }

    for (const form of compound) required.push(requiredForm(form));
    return required;
  }
}

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
  const scripts = new Map<string, LanguageScript>();
  for (const language of languages) {
    const required = sets.forLanguage(language);
    const script = scripts.get(language.script) ?? {
      script: language.script,
      groups: [],
      languages: [],
    };
    script.languages.push({
      language,
      presentCount: presentCount(required),
      requiredCount: required.length,
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

  const tracked = new Set(trackedLanguageIds);
  const groupRequired = new Map<string, RequiredGlyph[]>();
  const trackedScripts = sortedScripts.flatMap((script) => {
    const scriptLanguages = script.languages.filter(({ language }) => tracked.has(language.id));
    if (scriptLanguages.length === 0) return [];

    const groups = sets
      .groupsFor(
        script.script,
        scriptLanguages.map(({ language }) => language),
      )
      .map(({ group, required }): ScriptGroupCoverage => {
        groupRequired.set(group.id, required);
        return { group, presentCount: presentCount(required), requiredCount: required.length };
      });
    return [{ script: script.script, groups, languages: scriptLanguages }];
  });

  const required = (setId: string): RequiredGlyph[] => {
    const language = languagesById.get(setId);
    if (language) return sets.forLanguage(language);

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
    has,
  };
}

/** Reads an unencoded GlyphData letter as a form, or `null` when it is not one a set needs. */
function formOf(glyph: Glyph, codepointFor: (name: string) => number | null): Form | null {
  if (glyph.codepoint !== null || glyph.script === null || glyph.category !== "Letter") return null;

  const [, ...suffixes] = glyph.name.split(".");
  if (suffixes.length > 1) return null;

  const [suffix] = suffixes;
  if (suffix !== undefined && !POSITIONS.has(suffix)) return null;

  const characters = charactersOf(glyph, codepointFor);
  if (!characters) return null;

  const ligature = glyph.subCategory === "Ligature";
  const required = ligature
    ? (REQUIRED_LIGATURES.get(glyph.script)?.test(glyph.name) ?? false)
    : !ALTERNATE_FORM_SCRIPTS.has(glyph.script);
  return {
    glyph,
    characters,
    position: (suffix as GlyphPosition | undefined) ?? null,
    ligature,
    required,
  };
}

/** The characters a glyph shapes, from its production name or else its own name. */
function charactersOf(
  glyph: Glyph,
  codepointFor: (name: string) => number | null,
): number[] | null {
  const production = glyph.production
    ? charactersOfName(baseName(glyph.production), codepointFor)
    : null;
  return production ?? charactersOfName(baseName(glyph.name), codepointFor);
}

/**
 * Reads `uni06440627`, `u1F600`, a known glyph name, or a ligature of them
 * (`lam_alef-ar`, whose parts share its `-ar` script suffix).
 */
function charactersOfName(
  name: string,
  codepointFor: (name: string) => number | null,
): number[] | null {
  const sequence = UNI_SEQUENCE.exec(name)?.[1];
  if (sequence) {
    return sequence.match(/.{4}/g)?.map((hex) => Number.parseInt(hex, 16)) ?? null;
  }

  const scalar = U_SCALAR.exec(name)?.[1];
  if (scalar) return [Number.parseInt(scalar, 16)];

  const parts = name.split("_");
  if (parts.length === 1) {
    const codepoint = codepointFor(name);
    return codepoint === null ? null : [codepoint];
  }

  const last = parts.at(-1) ?? "";
  const scriptSuffix = last.includes("-") ? last.slice(last.lastIndexOf("-")) : "";
  const characters: number[] = [];
  for (const part of parts) {
    const partName = part.includes("-") ? part : `${part}${scriptSuffix}`;
    const partCharacters = charactersOfName(partName, codepointFor);
    if (!partCharacters) return null;

    characters.push(...partCharacters);
  }
  return characters;
}

const ZERO_WIDTH_JOINER = "\u200d";

/**
 * Text that shows a required glyph: its characters, with zero-width joiners
 * around a positional form so `beh-ar.init` renders joined to what follows.
 */
export function glyphPreviewText(glyph: RequiredGlyph): string {
  const text = String.fromCodePoint(...glyph.characters);
  switch (glyph.position) {
    case "init":
      return `${text}${ZERO_WIDTH_JOINER}`;
    case "medi":
      return `${ZERO_WIDTH_JOINER}${text}${ZERO_WIDTH_JOINER}`;
    case "fina":
      return `${ZERO_WIDTH_JOINER}${text}`;
    case null:
      return text;
  }
}

function requiredForm(form: Form): RequiredGlyph {
  return {
    name: form.glyph.name,
    codepoint: null,
    characters: [...form.characters],
    position: form.position,
  };
}

function within(characters: readonly number[], available: ReadonlySet<number>): boolean {
  return characters.every((character) => available.has(character));
}

function baseName(name: string): string {
  const suffixStart = name.indexOf(".");
  return suffixStart > 0 ? name.slice(0, suffixStart) : name;
}

/** GlyphData names scripts in lower case (`arabic`); Hyperglot capitalizes them (`Arabic`). */
function scriptKey(script: string): string {
  return script.toLowerCase();
}
