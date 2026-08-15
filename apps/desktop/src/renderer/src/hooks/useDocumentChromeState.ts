import { useMemo, useSyncExternalStore } from "react";

import { effect, useSignalState } from "@/lib/signals";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { WorkspaceApplyStatus } from "@/lib/workspace/WorkspaceEditCoordinator";

export type DocumentActivity = "clean" | "editing" | "committing" | "dirty";

type DocumentChromeState = {
  readonly documentState: WorkspaceDocumentState | null;
  readonly filename: string;
  readonly activity: DocumentActivity;
  readonly dirty: boolean;
};

export function useDocumentChromeState(): DocumentChromeState {
  const session = useFontSession();
  const workspace = session.workspace;
  const editor = useEditor();
  const metadata = useSignalState(editor.font.metadataCell);
  const documentState = useSyncExternalStore(
    (callback) => {
      if (!workspace) return () => {};

      const subscription = effect(() => {
        workspace.documentStateCell.value;
        callback();
      });
      return () => subscription.dispose();
    },
    () => workspace?.documentStateCell.peek() ?? null,
  );
  const applyStatus = useSyncExternalStore(
    (callback) => {
      if (!workspace) return () => {};

      const subscription = effect(() => {
        workspace.applyStatusCell.value;
        callback();
      });
      return () => subscription.dispose();
    },
    () => workspace?.applyStatusCell.peek() ?? "idle",
  );
  const isEditing = useSignalState(editor.isEditingCell);

  return useMemo(() => {
    if (!workspace) {
      return {
        documentState: null,
        filename: metadata.styleName ?? "Preview",
        activity: "clean",
        dirty: false,
      };
    }

    const activity = activityForDocument(documentState, isEditing, applyStatus);

    return {
      documentState,
      filename: filenameForDocument(documentState),
      activity,
      dirty: activity !== "clean",
    };
  }, [workspace, metadata.styleName, documentState, isEditing, applyStatus]);
}

function activityForDocument(
  documentState: WorkspaceDocumentState | null,
  isEditing: boolean,
  applyStatus: WorkspaceApplyStatus,
): DocumentActivity {
  if (documentState?.dirty) return "dirty";
  if (isEditing) return "editing";
  if (applyStatus !== "idle") return "committing";
  return "clean";
}

function filenameForDocument(state: WorkspaceDocumentState | null): string {
  const saveTarget = state?.saveTarget;
  if (!saveTarget) return "Untitled";

  return saveTarget.split(/[\\/]/).filter(Boolean).at(-1) ?? "Untitled";
}
