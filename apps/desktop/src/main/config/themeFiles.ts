import fs from "node:fs";
import path from "node:path";
import { themeRead } from "shift-bridge";
import type { ThemeFileState } from "../../shared/config/config";

export const THEMES_FOLDER_NAME = "themes";
const THEME_EXTENSION = ".toml";

/**
 * Reads every `*.toml` theme in `directory`, ordered by id.
 *
 * @remarks
 * A file that breaks keeps the theme it last read validly from `previous`,
 * so saving a half-edited theme never flashes the window to defaults.
 *
 * @param previous - the themes from the last read, by id.
 */
export function readThemeFiles(
  directory: string,
  previous: ReadonlyMap<string, ThemeFileState>,
): ThemeFileState[] {
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return names
    .filter((name) => name.endsWith(THEME_EXTENSION) && name.length > THEME_EXTENSION.length)
    .map((name) => name.slice(0, -THEME_EXTENSION.length))
    .sort()
    .map((id) => readThemeFile(directory, id, previous.get(id)?.theme ?? null));
}

function readThemeFile(
  directory: string,
  id: string,
  lastValid: ThemeFileState["theme"],
): ThemeFileState {
  const filePath = path.join(directory, `${id}${THEME_EXTENSION}`);
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = `Cannot read ${id}${THEME_EXTENSION}: ${(error as Error).message}`;
    return { id, path: filePath, theme: lastValid, problems: [{ severity: "error", message }] };
  }

  const read = themeRead(source);
  return { id, path: filePath, theme: read.theme ?? lastValid, problems: read.problems };
}
