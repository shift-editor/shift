import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { WorkspaceDocumentState } from "@shift/types";
import { computed, signal, useSignalState } from "@shift/editor/signals";
import { editorPath, glyphIdFromPath } from "@/lib/editorRoute";
import { DocumentViews, documentViewKey } from "@/lib/workspace/documentViews";
import { useFontSession } from "@/workspace/WorkspaceContext";

const NO_DOCUMENT_STATE = signal<WorkspaceDocumentState | null>(null, {
  name: "documentView.noDocumentState",
});
const documentViews = new DocumentViews();

/**
 * Remembers the glyph each document shows, and returns a window to it when main reopens
 * the document after an interruption.
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

    const glyphId = documentViews.read(key)?.glyphId;
    navigate(glyphId ? editorPath(glyphId) : "/home", { replace: true });
  }, [fontLoaded, key, navigate, resuming]);

  useEffect(() => {
    if (resuming || key === null) return;

    const glyphId = glyphIdFromPath(location.pathname);
    if (glyphId === null && location.pathname !== "/home") return;

    documentViews.write(key, glyphId === null ? {} : { glyphId });
  }, [key, location.pathname, resuming]);
}
