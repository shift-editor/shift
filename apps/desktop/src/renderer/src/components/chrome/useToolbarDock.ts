import { useCallback, useState } from "react";

import { TOOLBAR_DOCKS, type ToolbarDock } from "@shift/editor/ui";

export const TOOLBAR_DOCK_STORAGE_KEY = "shift:floating-toolbar-dock";

const DEFAULT_DOCK: ToolbarDock = "bottom";

type DockStorage = Pick<Storage, "getItem" | "setItem">;

/** Reads the remembered dock, falling back to the bottom edge. */
export function readToolbarDock(storage: DockStorage): ToolbarDock {
  try {
    const stored = storage.getItem(TOOLBAR_DOCK_STORAGE_KEY);
    return TOOLBAR_DOCKS.find((dock) => dock === stored) ?? DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
}

/** Remembers the dock; without storage it still applies for this session. */
export function writeToolbarDock(storage: DockStorage, dock: ToolbarDock): void {
  try {
    storage.setItem(TOOLBAR_DOCK_STORAGE_KEY, dock);
  } catch {
    // Remembering the dock is a convenience; the bar works without it.
  }
}

/** The floating toolbar's dock, remembered per viewer in `localStorage`. */
export const useToolbarDock = () => {
  const [dock, setDock] = useState(() => readToolbarDock(window.localStorage));
  const onDockChange = useCallback((next: ToolbarDock) => {
    setDock(next);
    writeToolbarDock(window.localStorage, next);
  }, []);

  return { dock, onDockChange };
};
