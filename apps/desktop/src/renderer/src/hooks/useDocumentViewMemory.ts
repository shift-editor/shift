import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { WorkspaceDocumentState } from "@shift/types";
import { computed, signal, useSignalState } from "@shift/editor/signals";
import { CANVAS_PATH, editorPath, glyphIdFromPath } from "@/lib/editorRoute";
import { DocumentViews, documentViewKey, type DocumentView } from "@/lib/workspace/documentViews";
import { useFontSession } from "@/workspace/WorkspaceContext";

const NO_DOCUMENT_STATE = signal<WorkspaceDocumentState | null>(null, {
  name: "documentView.noDocumentState",
});
const documentViews = new DocumentViews();

/** Where a remembered view returns the window: its glyph, the canvas, or Home. */
function resumePath(view: DocumentView | null): string {
  if (view?.glyphId) return editorPath(view.glyphId);
  if (view?.canvas) return CANVAS_PATH;
  return "/home";
}

/**
 * Remembers the glyph or canvas each document shows, and returns a window to it when main
 * reopens the document after an interruption. Tabs and the shown page are remembered by
 * `WindowViewMemory`.
 *
 * @remarks
 * Main marks such a load with a `resume` search param. Restoring replaces the route, which
 * drops the param; until then nothing is remembered, so the Home route the window loads on
 * cannot overwrite the glyph being restored.
 */
export function useDocumentViewMemory(): void {
  const session = useFontSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Document state changes on every edit; subscribe to its view key alone so the
  // whole document window does not re-render with each edit, undo, and redo.
  const documentStateCell = session.workspace?.documentStateCell ?? NO_DOCUMENT_STATE;
  const keyCell = useMemo(
    () =>
      computed(() => {
        const documentState = documentStateCell.value;
        return documentState ? documentViewKey(documentState) : null;
      }),
    [documentStateCell],
  );
  const key = useSignalState(keyCell);
  const fontLoaded = useSignalState(session.editor.font.loadedCell);
  const resuming = new URLSearchParams(location.search).has("resume");

  useEffect(() => {
    if (!resuming || key === null || !fontLoaded) return;

    navigate(resumePath(documentViews.read(key)), { replace: true });
  }, [fontLoaded, key, navigate, resuming]);

  useEffect(() => {
    if (resuming || key === null) return;

    const glyphId = glyphIdFromPath(location.pathname);
    const canvas = location.pathname === CANVAS_PATH;
    if (glyphId === null && !canvas && location.pathname !== "/home") return;

    documentViews.update(key, {
      glyphId: glyphId ?? undefined,
      canvas: canvas ? true : undefined,
    });
  }, [key, location.pathname, resuming]);
}
