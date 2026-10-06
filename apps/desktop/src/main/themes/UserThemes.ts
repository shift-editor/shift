import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  THEME_FILE_EXTENSIONS,
  USER_THEME_PREFIX,
  parseBase16Scheme,
  serializeBase16Scheme,
  uniqueThemeSlug,
  userThemeSlug,
  type ColorTheme,
} from "../../shared/themes";

/**
 * Main-owned color themes the user created or imported.
 *
 * @remarks
 * Each theme is one Base16 scheme file in the themes directory, and its id is
 * {@link USER_THEME_PREFIX} plus the file name without extension. Files the
 * user drops into the directory are listed too; unreadable or incomplete
 * schemes are skipped rather than failing the list. New themes are written as
 * YAML; an existing file keeps its YAML or JSON format when saved.
 */
export class UserThemes {
  readonly #directory: string;
  readonly #listeners = new Set<() => void>();

  /**
   * @param directory - folder that holds one scheme file per theme; created on first write.
   */
  constructor(directory: string) {
    this.#directory = directory;
  }

  /** Folder that holds the theme files. */
  get directory(): string {
    return this.#directory;
  }

  /**
   * Reads every valid theme file, sorted by name.
   *
   * @returns a fresh list on every call so external edits are picked up.
   */
  list(): ColorTheme[] {
    return this.#files()
      .flatMap(({ slug, filePath }) => {
        const theme = readTheme(filePath, `${USER_THEME_PREFIX}${slug}`);
        return theme ? [theme] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Creates or replaces a theme.
   *
   * @param theme - validated theme whose id must be a safe user id.
   * @throws {Error} when the id is not a user theme id.
   */
  save(theme: ColorTheme): void {
    const slug = userThemeSlug(theme.id);
    if (!slug) throw new Error(`Cannot save theme with id ${theme.id}`);

    const filePath = this.#fileForSlug(slug) ?? path.join(this.#directory, `${slug}.yaml`);
    writeTheme(filePath, theme);
    this.#notify();
  }

  /**
   * Deletes a theme's file.
   *
   * @returns whether a file was removed.
   */
  remove(id: string): boolean {
    const slug = userThemeSlug(id);
    const filePath = slug ? this.#fileForSlug(slug) : null;
    if (!filePath) return false;

    fs.rmSync(filePath, { force: true });
    this.#notify();
    return true;
  }

  /**
   * Copies a Base16 scheme file into the themes directory under a fresh id.
   *
   * @param sourcePath - YAML or JSON scheme file to read.
   * @returns the imported theme, or null when the file is not a complete scheme.
   */
  import(sourcePath: string): ColorTheme | null {
    const parsed = readTheme(sourcePath, "");
    if (!parsed) return null;

    const taken = new Set(this.#files().map(({ slug }) => slug));
    const theme = { ...parsed, id: `${USER_THEME_PREFIX}${uniqueThemeSlug(parsed.name, taken)}` };
    this.save(theme);
    return theme;
  }

  /** Writes any theme, built-in or user, as a scheme file at `destinationPath`. */
  export(theme: ColorTheme, destinationPath: string): void {
    writeTheme(destinationPath, theme);
  }

  /**
   * Subscribes to saves, imports, and removals made through this store.
   *
   * @returns an unsubscribe function.
   */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #fileForSlug(slug: string): string | null {
    return this.#files().find((file) => file.slug === slug)?.filePath ?? null;
  }

  #files(): { slug: string; filePath: string }[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.#directory);
    } catch {
      return [];
    }

    return names.flatMap((name) => {
      const { name: slug, ext } = path.parse(name);
      if (!isThemeExtension(ext) || !userThemeSlug(`${USER_THEME_PREFIX}${slug}`)) return [];

      return [{ slug, filePath: path.join(this.#directory, name) }];
    });
  }
}

function readTheme(filePath: string, id: string): ColorTheme | null {
  try {
    return parseBase16Scheme(yaml.load(fs.readFileSync(filePath, "utf8")), id);
  } catch {
    return null;
  }
}

function writeTheme(filePath: string, theme: ColorTheme): void {
  const document = serializeBase16Scheme(theme);
  const text =
    path.extname(filePath).toLowerCase() === ".json"
      ? `${JSON.stringify(document, null, 2)}\n`
      : yaml.dump(document, { quotingType: '"', forceQuotes: true });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function isThemeExtension(extension: string): boolean {
  return (THEME_FILE_EXTENSIONS as readonly string[]).includes(extension.slice(1).toLowerCase());
}
