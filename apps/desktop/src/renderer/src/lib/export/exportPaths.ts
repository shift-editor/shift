/**
 * Pure helpers over the absolute paths main hands the renderer. The renderer
 * has no path module, and paths may use either separator.
 */

const SEPARATORS = /[\\/]/;

/** The separator `path` uses: a backslash when it has one and no forward slash. */
function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/** The last segment of `path`: a file or folder name. */
export function pathName(path: string): string {
  return path.split(SEPARATORS).filter(Boolean).at(-1) ?? path;
}

/** The folder holding `path`, or null for a root or a bare name. */
export function parentFolder(path: string): string | null {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : null;
}

/** `folder` with `name` inside it, in the folder's own separator. */
export function childPath(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

/** The last two segments of `folder`, as a short breadcrumb such as `Solenoid › fonts`. */
export function folderBreadcrumb(folder: string): readonly string[] {
  return folder.split(SEPARATORS).filter(Boolean).slice(-2);
}

/**
 * `name` shortened to fit by cutting the middle: everything from its first
 * `-` (an instance's style and the extension) is kept whole, and the start is
 * shortened behind an ellipsis, as in `Mutator…-LightCondensed.ttf`. A name
 * without a `-` keeps its extension instead.
 *
 * @param fits - Whether a candidate fits, such as by its measured width.
 * @returns `name` itself when it fits.
 */
export function middleCut(name: string, fits: (text: string) => boolean): string {
  if (fits(name)) return name;
  const split = cutPoint(name);
  const start = name.slice(0, split);
  const end = name.slice(split);
  for (let length = start.length - 1; length > 0; length -= 1) {
    const candidate = `${start.slice(0, length)}…${end}`;
    if (fits(candidate)) return candidate;
  }
  return `…${end}`;
}

/** Where `middleCut` keeps the rest whole: the first `-`, else the extension, else the end. */
function cutPoint(name: string): number {
  const dash = name.indexOf("-");
  if (dash > 0) return dash;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
