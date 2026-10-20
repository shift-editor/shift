import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { useSignalState } from "@shift/editor/signals";
import type { EditorCommandId } from "@shared/commands";
import { TOOL_WINDOW_PREFIX } from "@shared/toolWindows";
import { registerToolWindowCommands } from "@/lib/commands/toolWindowCommands";
import { openChildWindow, type WindowBounds } from "@/lib/windows/childWindow";
import { useNavigate } from "react-router";
import type { GlyphName } from "@shift/types";
import { PortalContainerProvider } from "@shift/ui";
import { editorPath } from "@/lib/editorRoute";
import { getShiftHost } from "@/host/shiftHost";
import { registerBeforeSave } from "@/lib/documents/beforeSave";
import { FontSessionContext, useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { zoomCode } from "./codeZoom";
import { FeatureCodePanel } from "./FeatureCodePanel";
import type { FeatureCodeSync } from "./FeatureCodeSync";
import { featureCodeOpenCell } from "./featureCodeState";

const BOUNDS_KEY = "shift.featureCodeWindow.bounds";
const PINNED_KEY = "shift.featureCodeWindow.pinned";
const WINDOW_NAME = `${TOOL_WINDOW_PREFIX}feature-code`;

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
  const syncRef = useRef<FeatureCodeSync | null>(null);
  const editor = useEditor();
  const navigate = useNavigate();
  // Read when a glyph opens, so a route change never reopens the window.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Saving includes typing the window has not applied yet, then formats when the font asks for it.
  useEffect(
    () =>
      registerBeforeSave(async () => {
        syncRef.current?.flush();
        const settings = await editor.font.featureCodeSettings();
        if (!settings.formatOnSave) return;
        const source = await editor.font.featureSource();
        if (source === null) return;
        const formatted = await editor.font.formatFeatureCode(source);
        if (formatted === source) return;
        editor.history.capture("Format Feature Code", () =>
          editor.font.setFeatureSource(formatted),
        );
      }),
    [editor],
  );

  useEffect(() => {
    if (!open) return undefined;
    const child = openChildWindow({
      name: WINDOW_NAME,
      title: `Feature Code — ${familyName}`,
      bounds: savedBounds(),
    });
    if (!child) {
      featureCodeOpenCell.set(false);
      return undefined;
    }

    const setPinned = (pinned: boolean) => {
      void getShiftHost().window.setToolWindowPinned(WINDOW_NAME, pinned);
      remember(PINNED_KEY, pinned);
    };
    const pinned = recall<boolean>(PINNED_KEY) ?? false;
    if (pinned) setPinned(true);

    const root = createRoot(child.container);
    root.render(
      <FontSessionContext.Provider value={session}>
        <PortalContainerProvider container={child.window.document.body}>
          <FeatureCodePanel
            onView={(view) => (viewRef.current = view)}
            onSync={(sync) => (syncRef.current = sync)}
            initiallyPinned={pinned}
            onPinnedChange={setPinned}
            onOpenGlyph={(name) => {
              const entry = editor.font.entryForName(name as GlyphName);
              if (!entry) return;
              navigateRef.current(editorPath(entry.id));
              window.focus();
            }}
          />
        </PortalContainerProvider>
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
  }, [open, session, familyName, editor]);

  return null;
};

/** The menu commands the feature code editor handles itself (zoom sizes only the code); Save and the rest stay with the document. */
const EDIT_COMMANDS = new Set<EditorCommandId>([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
  "view.zoomIn",
  "view.zoomOut",
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
    case "view.zoomIn":
      return zoomCode(view, 1);
    case "view.zoomOut":
      return zoomCode(view, -1);
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

/** A value this window remembered in local storage, or null; private storage may refuse it. */
function recall<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

/** Remembers `value` for the next time the window opens; a convenience private storage may refuse. */
function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembering is harmless.
  }
}

function savedBounds(): WindowBounds {
  const fallback = {
    x: window.screenX + Math.max(0, window.outerWidth - 760),
    y: window.screenY + 60,
    width: 720,
    height: Math.min(860, window.outerHeight - 80),
  };
  return recall<WindowBounds>(BOUNDS_KEY) ?? fallback;
}

function saveBounds(bounds: WindowBounds): void {
  remember(BOUNDS_KEY, bounds);
}
