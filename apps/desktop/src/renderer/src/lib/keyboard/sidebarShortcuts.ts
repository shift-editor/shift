import type { KeyChord } from "./types";

export const sidebarShortcuts = {
  "align.left": { code: "KeyA", altKey: true, shiftKey: false, primaryModifier: false },
  "align.center-h": { code: "KeyH", altKey: true, shiftKey: false, primaryModifier: false },
  "align.right": { code: "KeyD", altKey: true, shiftKey: false, primaryModifier: false },
  "align.top": { code: "KeyW", altKey: true, shiftKey: false, primaryModifier: false },
  "align.center-v": { code: "KeyV", altKey: true, shiftKey: false, primaryModifier: false },
  "align.bottom": { code: "KeyS", altKey: true, shiftKey: false, primaryModifier: false },
  "boolean.union": { code: "KeyU", altKey: true, shiftKey: true, primaryModifier: false },
  "boolean.intersect": { code: "KeyI", altKey: true, shiftKey: true, primaryModifier: false },
  "boolean.subtract": { code: "KeyS", altKey: true, shiftKey: true, primaryModifier: false },
  "flip.horizontal": { code: "KeyH", altKey: false, shiftKey: true, primaryModifier: false },
  "flip.vertical": { code: "KeyV", altKey: false, shiftKey: true, primaryModifier: false },
} satisfies Record<string, KeyChord>;

export function formatSidebarShortcut(shortcut: KeyChord, isMac: boolean): string {
  const key = shortcut.code?.replace("Key", "") ?? "";
  if (isMac) {
    const alt = shortcut.altKey ? "⌥" : "";
    const shift = shortcut.shiftKey ? "⇧" : "";
    return `${alt}${shift}${key}`;
  }

  const alt = shortcut.altKey ? "Alt+" : "";
  const shift = shortcut.shiftKey ? "Shift+" : "";
  return `${alt}${shift}${key}`;
}
