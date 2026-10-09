import type { CommandShortcut } from "@shared/commands";

/**
 * Formats an application command shortcut the way the platform's menus show it:
 * `⌘⇧O` on macOS, `Ctrl+Shift+O` on Windows and Linux.
 */
export function commandShortcutLabel(shortcut: CommandShortcut, isMac: boolean): string {
  const key = shortcut.key.toUpperCase();
  if (isMac) {
    const alt = shortcut.altKey ? "⌥" : "";
    const shift = shortcut.shiftKey ? "⇧" : "";
    return `${shortcut.primaryModifier ? "⌘" : ""}${alt}${shift}${key}`;
  }

  const parts = [
    shortcut.primaryModifier && "Ctrl",
    shortcut.altKey && "Alt",
    shortcut.shiftKey && "Shift",
    key,
  ];
  return parts.filter(Boolean).join("+");
}
