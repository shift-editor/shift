import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WindowButton, WindowButtonLayout } from "../../shared/menu/types";

const execFileAsync = promisify(execFile);

/** GNOME's own default, used when the desktop does not report a layout. */
const DEFAULT_LAYOUT = "appmenu:minimize,maximize,close";
const BUTTONS = new Set<WindowButton>(["minimize", "maximize", "close"]);

/**
 * Parses a desktop button layout such as `close,minimize:` or `appmenu:close`.
 *
 * @remarks
 * The part before `:` is the start of the title bar and the part after is the
 * end. Entries Shift does not draw (`appmenu`, `icon`, `spacer`) are ignored.
 */
export function parseButtonLayout(value: string): WindowButtonLayout {
  const [start = "", end = ""] = value.split(":");
  return { start: windowButtons(start), end: windowButtons(end) };
}

/**
 * Reads the desktop's window-button layout on Linux.
 *
 * @remarks
 * Asks the XDG desktop portal first, which GNOME and other desktops answer,
 * then GNOME's settings directly, then falls back to GNOME's default.
 */
export async function readButtonLayout(): Promise<WindowButtonLayout> {
  const value = (await readFromPortal()) ?? (await readFromGSettings()) ?? DEFAULT_LAYOUT;
  return parseButtonLayout(value);
}

function windowButtons(names: string): WindowButton[] {
  return names
    .split(",")
    .map((name) => name.trim())
    .filter((name): name is WindowButton => BUTTONS.has(name as WindowButton));
}

async function readFromPortal(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.portal.Desktop",
      "--object-path",
      "/org/freedesktop/portal/desktop",
      "--method",
      "org.freedesktop.portal.Settings.ReadOne",
      "org.gnome.desktop.wm.preferences",
      "button-layout",
    ]);
    return quotedValue(stdout);
  } catch {
    return null;
  }
}

async function readFromGSettings(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gsettings", [
      "get",
      "org.gnome.desktop.wm.preferences",
      "button-layout",
    ]);
    return quotedValue(stdout);
  } catch {
    return null;
  }
}

/** Extracts the first single-quoted string, as `gdbus` and `gsettings` print it. */
function quotedValue(output: string): string | null {
  return /'([^']*)'/.exec(output)?.[1] ?? null;
}
