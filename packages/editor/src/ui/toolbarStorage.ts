import type { ToolbarDock, ToolbarStorage } from "../types/toolbar";
import { TOOLBAR_DOCKS } from "./toolbarPose";

export const TOOLBAR_STORAGE_KEY = "shift:floating-toolbar-dock";

const DEFAULT_DOCK: ToolbarDock = "bottom";

function defaultToolbarStorage(): ToolbarStorage | null {
  if (typeof localStorage === "undefined") return null;

  return localStorage;
}

/** Reads the remembered dock, falling back to the bottom edge. */
export function readToolbarDock(
  storage: ToolbarStorage | null = defaultToolbarStorage(),
): ToolbarDock {
  if (!storage) return DEFAULT_DOCK;

  try {
    const stored = storage.getItem(TOOLBAR_STORAGE_KEY);

    return TOOLBAR_DOCKS.find((dock) => dock === stored) ?? DEFAULT_DOCK;
  } catch {
    // Remembering the dock is a convenience; the default is fine.
    return DEFAULT_DOCK;
  }
}

/** Remembers the dock. */
export function writeToolbarDock(
  dock: ToolbarDock,
  storage: ToolbarStorage | null = defaultToolbarStorage(),
): void {
  if (!storage) return;

  try {
    storage.setItem(TOOLBAR_STORAGE_KEY, dock);
  } catch {
    // Remembering the dock is a convenience; the bar works without it.
  }
}
