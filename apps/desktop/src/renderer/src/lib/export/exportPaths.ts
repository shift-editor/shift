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
