import { isDeepStrictEqual } from "node:util";
import { parse, TomlError, type TomlTable } from "smol-toml";
import type { ConfigProblem } from "../../shared/config/config";

/** Settings this build reads from `config.toml`. */
export interface ConfigValues {
  /** A theme id or `system`; `null` when the file does not choose one. */
  theme: string | null;
}

/**
 * The result of reading `config.toml`: its values, or `null` values when an
 * error means the file must not be applied.
 */
export interface ConfigRead {
  values: ConfigValues | null;
  problems: ConfigProblem[];
}

const KNOWN_KEYS = new Set(["theme"]);

/**
 * Reads the settings in a `config.toml` source.
 *
 * @remarks
 * Unknown keys are warnings rather than errors, so a file written for a newer
 * build still applies the settings this build understands.
 */
export function readConfig(source: string): ConfigRead {
  let table: TomlTable;
  try {
    table = parse(source);
  } catch (error) {
    return { values: null, problems: [syntaxProblem(error)] };
  }

  const problems: ConfigProblem[] = [];
  for (const key of Object.keys(table)) {
    if (KNOWN_KEYS.has(key)) continue;
    problems.push({
      severity: "warning",
      message: `Unknown setting "${key}" is ignored.`,
      ...keyLocation(source, key),
    });
  }

  const theme = table.theme;
  if (theme !== undefined && typeof theme !== "string") {
    problems.push({
      severity: "error",
      message: `"theme" must be a string, such as theme = "nord".`,
      ...keyLocation(source, "theme"),
    });
    return { values: null, problems };
  }

  return { values: { theme: theme ?? null }, problems };
}

/**
 * Returns `source` with its top-level `theme` set to `theme`, changing only
 * that value.
 *
 * @remarks
 * Every other byte, including comments and key order, is preserved. A missing
 * `theme` is added before the first table, or at the end of a file without
 * tables.
 *
 * @param source - the current file, or `null` when it does not exist yet.
 * @throws Error when `source` does not parse, or when its `theme` is written in
 * a form this edit cannot change safely, such as a multi-line string.
 */
export function setConfigTheme(source: string | null, theme: string): string {
  const value = JSON.stringify(theme);
  if (source === null) return `theme = ${value}\n`;

  const original = parse(source);
  const replaced = replaceTopLevelValue(source, "theme", value);
  if (replaced === UNEDITABLE) throw uneditable();

  const edited = replaced ?? insertTopLevel(source, "theme", value);
  if (!isDeepStrictEqual(parseOrNull(edited), { ...original, theme })) throw uneditable();
  return edited;
}

/** The first line index of a table header, or the line count when there is none. */
function topLevelEnd(lines: readonly string[]): number {
  const index = lines.findIndex((line) => line.trimStart().startsWith("["));
  return index === -1 ? lines.length : index;
}

/** Matches a top-level `key = value` line, bare or quoted; `key` may come from the user's file. */
function keyPattern(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`^(\s*(?:${escaped}|"${escaped}"|'${escaped}')\s*=\s*)(.*)$`);
}

const UNEDITABLE = Symbol("uneditable");

function uneditable(): Error {
  return new Error(`Cannot update "theme" in config.toml; edit it by hand.`);
}

function parseOrNull(source: string): TomlTable | null {
  try {
    return parse(source);
  } catch {
    return null;
  }
}

/**
 * Replaces the value of a top-level `key = value` line, keeping any trailing
 * comment; `null` when the key is absent, `UNEDITABLE` when its value spans
 * lines.
 */
function replaceTopLevelValue(
  source: string,
  key: string,
  value: string,
): string | typeof UNEDITABLE | null {
  const lines = source.split("\n");
  const end = topLevelEnd(lines);
  const pattern = keyPattern(key);
  for (let index = 0; index < end; index++) {
    const match = pattern.exec(lines[index]);
    if (!match) continue;

    const [, prefix, rest] = match;
    const valueEnd = scalarEnd(rest);
    if (valueEnd === null) return UNEDITABLE;
    lines[index] = `${prefix}${value}${rest.slice(valueEnd)}`;
    return lines.join("\n");
  }
  return null;
}

/** Inserts `key = value` at the end of the top-level section. */
function insertTopLevel(source: string, key: string, value: string): string {
  const lines = source.split("\n");
  const end = topLevelEnd(lines);
  const line = `${key} = ${value}`;
  if (end === lines.length) {
    const trailingNewline = source.length === 0 || source.endsWith("\n");
    return `${source}${trailingNewline ? "" : "\n"}${line}\n`;
  }

  lines.splice(end, 0, line, "");
  return lines.join("\n");
}

/**
 * Returns where a single-line scalar ends in `rest`, or `null` for a
 * multi-line string, which a line edit cannot replace.
 */
function scalarEnd(rest: string): number | null {
  if (rest.startsWith(`"""`) || rest.startsWith("'''")) return null;

  if (rest.startsWith('"')) {
    for (let index = 1; index < rest.length; index++) {
      if (rest[index] === "\\") index++;
      else if (rest[index] === '"') return index + 1;
    }
    return null;
  }

  if (rest.startsWith("'")) {
    const close = rest.indexOf("'", 1);
    return close === -1 ? null : close + 1;
  }

  const comment = rest.indexOf("#");
  const bare = comment === -1 ? rest : rest.slice(0, comment);
  return bare.trimEnd().length;
}

/** Locates a top-level key's line for a problem report. */
function keyLocation(source: string, key: string): Pick<ConfigProblem, "line" | "column"> {
  const lines = source.split("\n");
  const pattern = keyPattern(key);
  const index = lines.slice(0, topLevelEnd(lines)).findIndex((line) => pattern.test(line));
  if (index === -1) return { line: null, column: null };
  return { line: index + 1, column: lines[index].search(/\S/) + 1 };
}

function syntaxProblem(error: unknown): ConfigProblem {
  if (error instanceof TomlError) {
    // TomlError messages end with a code frame; Settings shows the location instead.
    const [summary] = error.message.split("\n");
    return { severity: "error", message: summary, line: error.line, column: error.column };
  }
  return { severity: "error", message: String(error), line: null, column: null };
}
