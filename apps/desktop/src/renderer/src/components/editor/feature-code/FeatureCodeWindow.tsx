import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { useSignalState } from "@shift/editor/signals";
import type { EditorCommandId } from "@shared/commands";
import { TOOL_WINDOW_PREFIX } from "@shared/toolWindows";
import { registerToolWindowCommands } from "@/lib/commands/toolWindowCommands";
import { openChildWindow, type WindowBounds } from "@/lib/windows/childWindow";
import { FontSessionContext, useFontSession } from "@/workspace/WorkspaceContext";
import { FeatureCodePanel } from "./FeatureCodePanel";
import { featureCodeOpenCell } from "./featureCodeState";

const BOUNDS_KEY = "shift.featureCodeWindow.bounds";

/**
 * Shows the feature code editor in its own OS window while
 * {@link featureCodeOpenCell} is set. The window runs in this renderer, so it
 * edits the same font with the same history; closing it clears the cell.
 */
export const FeatureCodeWindow = () => {
  const open = useSignalState(featureCodeOpenCell);
  const session = useFontSession();
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const child = openChildWindow({
      name: `${TOOL_WINDOW_PREFIX}feature-code`,
      title: `Feature Code — ${familyName}`,
      bounds: savedBounds(),
    });
    if (!child) {
      featureCodeOpenCell.set(false);
      return undefined;
    }

    const root = createRoot(child.container);
    root.render(
      <FontSessionContext.Provider value={session}>
        <FeatureCodePanel onView={(view) => (viewRef.current = view)} />
      </FontSessionContext.Provider>,
    );

    const unregister = registerToolWindowCommands((id) => {
      const view = viewRef.current;
      if (!view || !child.window.document.hasFocus() || !EDIT_COMMANDS.has(id)) return null;
      return runEditorCommand(view, child.window, id);
    });

    let unloading = false;
    const onClose = () => {
      if (unloading) return;
      unloading = true;
      saveBounds(child.bounds());
      featureCodeOpenCell.set(false);
    };
    child.window.addEventListener("pagehide", onClose);

    return () => {
      unregister();
      child.window.removeEventListener("pagehide", onClose);
      if (!unloading) saveBounds(child.bounds());
      root.unmount();
      child.close();
    };
  }, [open, session, familyName]);

  return null;
};

/** The menu commands the feature code editor handles itself; Save and the rest stay with the document. */
const EDIT_COMMANDS = new Set<EditorCommandId>([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
]);

/** Runs an Edit-menu command in the feature code editor. */
async function runEditorCommand(
  view: EditorView,
  child: Window,
  id: EditorCommandId,
): Promise<boolean> {
  switch (id) {
    case "edit.undo":
      return undo(view);
    case "edit.redo":
      return redo(view);
    case "edit.selectAll":
      return selectAll(view);
    case "edit.copy":
    case "edit.cut": {
      const text = view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      );
      if (text === "") return false;
      await child.navigator.clipboard.writeText(text);
      if (id === "edit.cut") view.dispatch(view.state.replaceSelection(""));
      return true;
    }
    case "edit.paste": {
      const text = await child.navigator.clipboard.readText();
      view.dispatch(view.state.replaceSelection(text));
      return true;
    }
    default:
      return false;
  }
}

function savedBounds(): WindowBounds {
  const fallback = {
    x: window.screenX + Math.max(0, window.outerWidth - 760),
    y: window.screenY + 60,
    width: 720,
    height: Math.min(860, window.outerHeight - 80),
  };
  try {
    const stored = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? "null") as WindowBounds | null;
    return stored ?? fallback;
  } catch {
    return fallback;
  }
}

function saveBounds(bounds: WindowBounds): void {
  try {
    localStorage.setItem(BOUNDS_KEY, JSON.stringify(bounds));
  } catch {
    // Remembering the window's place is a convenience; private storage may refuse it.
  }
}
