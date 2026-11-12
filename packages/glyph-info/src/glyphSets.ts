import { ascending, comparing, descending } from "@shift/types";
import { casingCharacters, unicodeGroups } from "./scriptGroups.js";
import type {
  Glyph,
  GlyphPosition,
  Language,
  LetterSkeleton,
  RequiredGlyph,
  ScriptGroupDefinition,
  JoiningType,
  UnicodeProperties,
} from "./types.js";

/** Ligatures a script's shaping always forms, so its languages require them: Arabic's lam-alef. */
const REQUIRED_LIGATURES: ReadonlyMap<string, RegExp> = new Map([
  ["arabic", /^lam_alef(?!Maksura)/],
]);

/**
 * Scripts whose unencoded letters are locale alternates (`idotaccent`,
 * `Jacute`), not forms shaping needs. A language requires one only when its
 * own casing rules (SpecialCasing.txt) map every character the form shows.
 */
const ALTERNATE_FORM_SCRIPTS: ReadonlySet<string> = new Set(["latin", "cyrillic", "greek"]);

const POSITIONS: ReadonlySet<string> = new Set<GlyphPosition>(["init", "medi", "fina"]);

/** The forms a joining letter takes, in the order the sidebar lists them. */
const FORMS_BY_JOINING: Record<JoiningType, readonly GlyphPosition[]> = {
  D: ["fina", "medi", "init"],
  R: ["fina"],
  L: ["init"],
};
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
  /** A locale alternate (`idotaccent`), required only by languages whose casing rules need it. */
  readonly alternate: boolean;
}

/** Most-spoken first, so a script's Basic set lists its main language's glyphs in that language's order. */
const byMostSpoken = comparing((language: Language) => language.speakers, descending);

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
  readonly #unicode: UnicodeProperties;
  readonly #consonants: ReadonlySet<number>;
  readonly #viramas: ReadonlySet<number>;
  readonly #joining: ReadonlyMap<number, JoiningType>;
  // non-reactive: memoizes immutable reference data, never read by computed/effects.
  readonly #requiredByLanguage = new Map<string, RequiredGlyph[]>();
  // non-reactive: memoizes immutable reference data, never read by computed/effects.
  readonly #basicByScript = new Map<string, RequiredGlyph[]>();
  // non-reactive: memoizes immutable reference data, never read by computed/effects.
  readonly #groupsByLanguages = new Map<string, ScriptGroupDefinition[]>();

  /**
   * @param glyphs - every GlyphData entry, encoded or not.
   * @param codepointFor - resolves a GlyphData, production or alternate name to its codepoint.
   * @param nameFor - names a character's glyph.
   * @param skeletons - each joining-script letter's dotless skeleton, from Unicode.
   * @param unicode - the other Unicode properties groups read.
   */
  constructor(
    glyphs: readonly Glyph[],
    codepointFor: (name: string) => number | null,
    nameFor: (codepoint: number) => string,
    skeletons: readonly LetterSkeleton[],
    unicode: UnicodeProperties,
  ) {
    this.#unicode = unicode;
    this.#consonants = new Set(unicode.indic.consonants);
    this.#viramas = new Set(unicode.indic.viramas);
    this.#joining = new Map(unicode.joining.map(({ codepoint, type }) => [codepoint, type]));
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
    const casing = casingCharacters(this.#unicode, language.id);
    const forms = this.#forms(language.script).filter(
      (form) =>
        within(form.characters, available) &&
        (form.required || (form.alternate && casing.size > 0 && within(form.characters, casing))),
    );
    const required = this.#ordered(language.baseCodepoints, forms);
    this.#requiredByLanguage.set(language.id, required);
    return required;
  }

  /**
   * A script's Basic set: every glyph the languages of most of its speakers
   * need, so each language lists only what it adds. Weighing by speakers, not
   * by language count, keeps Q in Latin's Basic although many small Latin
   * orthographies skip it. Counts only languages listed in their own right,
   * and is empty for a script with fewer than two of them, whose one language
   * then lists everything.
   *
   * @param languages - every language of the script, tracked or not.
   */
  basicFor(script: string, languages: readonly Language[]): RequiredGlyph[] {
    const cached = this.#basicByScript.get(script);
    if (cached) return cached;

    const listed = languages.filter(({ coveredBy }) => coveredBy === null).toSorted(byMostSpoken);
    const totalSpeakers = listed.reduce((sum, { speakers }) => sum + speakers, 0);
    const speakersOf = new Map<string, number>();
    const glyphs = new Map<string, RequiredGlyph>();
    for (const language of listed) {
      for (const glyph of this.forLanguage(language)) {
        if (!glyphs.has(glyph.name)) glyphs.set(glyph.name, glyph);
        speakersOf.set(glyph.name, (speakersOf.get(glyph.name) ?? 0) + language.speakers);
      }
    }

    const basic =
      listed.length < 2
        ? []
        : glyphs
            .values()
            .filter(({ name }) => (speakersOf.get(name) ?? 0) * 2 > totalSpeakers)
            .toArray();
    this.#basicByScript.set(script, basic);
    return basic;
  }

  /**
   * The script groups shown beside a script's tracked languages.
   *
   * @param script - Hyperglot script name, such as `Arabic`.
   * @param languages - the script's tracked languages; their letters bound every group.
   */
  groupsFor(script: string, languages: readonly Language[]): ScriptGroupDefinition[] {
    const cacheKey = [script, ...languages.map(({ id }) => id).sort()].join("\u0000");
    const cached = this.#groupsByLanguages.get(cacheKey);
    if (cached) return cached;

    const groups = this.#buildGroups(script, languages);
    this.#groupsByLanguages.set(cacheKey, groups);
    return groups;
  }

  #buildGroups(script: string, languages: readonly Language[]): ScriptGroupDefinition[] {
    const key = scriptKey(script);
    const groups: ScriptGroupDefinition[] = [];

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
    const halfForms = this.#forms(script).filter(
      (form) => within(form.characters, available) && this.#isHalfForm(form),
    );
    if (halfForms.length > 0) {
      groups.push({
        group: { id: `${key}/half-forms`, name: "Half Forms", script },
        required: halfForms.map(requiredForm),
      });
    }

    groups.push(
      ...unicodeGroups({
        script,
        languages,
        unicode: this.#unicode,
        glyphFor: (codepoint) => this.#glyphFor(codepoint),
      }),
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

  /** A consonant and virama shown as one glyph, by IndicSyllabicCategory.txt. */
  #isHalfForm({ characters }: Form): boolean {
    const [consonant, virama, ...rest] = characters;
    return (
      rest.length === 0 &&
      consonant !== undefined &&
      virama !== undefined &&
      this.#consonants.has(consonant) &&
      this.#viramas.has(virama)
    );
  }

  /**
   * A joining letter's positional forms, from its Unicode joining type rather
   * than from GlyphData, which names forms for common letters only (it has
   * `beh-ar.init` but not `tehRing-ar.init`).
   */
  #positionalForms(letter: RequiredGlyph): RequiredGlyph[] {
    const type = letter.codepoint === null ? undefined : this.#joining.get(letter.codepoint);
    if (!type) return [];

    return FORMS_BY_JOINING[type].map((position) => ({
      name: `${letter.name}.${position}`,
      codepoint: null,
      characters: letter.characters,
      position,
    }));
  }

  #glyphFor(codepoint: number): RequiredGlyph {
    return { name: this.#nameFor(codepoint), codepoint, characters: [codepoint], position: null };
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
      const glyph = this.#glyphFor(codepoint);
      required.push(glyph, ...this.#positionalForms(glyph));
      for (const form of formsByCharacter.get(codepoint) ?? []) required.push(requiredForm(form));
    }

    for (const form of compound) required.push(requiredForm(form));
    return required;
  }
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

  // One letter's positional forms come from its Unicode joining type instead.
  if (suffix !== undefined && characters.length === 1) return null;

  // GlyphData leaves some ligatures unmarked (qaf_lam_yeh-ar); `_` joins a ligature's parts.
  const ligature = glyph.subCategory === "Ligature" || baseName(glyph.name).includes("_");
  const alternate = !ligature && ALTERNATE_FORM_SCRIPTS.has(glyph.script);
  const required = ligature
    ? (REQUIRED_LIGATURES.get(glyph.script)?.test(glyph.name) ?? false)
    : !alternate;
  return {
    glyph,
    characters,
    position: (suffix as GlyphPosition | undefined) ?? null,
    ligature,
    required,
    alternate,
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
