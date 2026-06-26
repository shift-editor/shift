import { useMemo } from "react";

import { useSignalState } from "@/lib/signals";
import { useEditor, useWorkspace } from "@/workspace/WorkspaceContext";

import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { WorkspaceCommitState } from "@/lib/workspace/WorkspaceEditCoordinator";

export type DocumentActivity = "clean" | "editing" | "committing" | "dirty";

type DocumentChromeState = {
  readonly documentState: WorkspaceDocumentState | null;
  readonly filename: string;
  readonly activity: DocumentActivity;
  readonly dirty: boolean;
};

export function useDocumentChromeState(): DocumentChromeState {
  const workspace = useWorkspace();
  const editor = useEditor();
  const documentState = useSignalState(workspace.documentStateCell);
  const isEditing = useSignalState(editor.isEditingCell);
  const commitState = useSignalState(workspace.commitStateCell);

  return useMemo(() => {
    const activity = activityForDocument(documentState, isEditing, commitState);

    return {
      documentState,
      filename: filenameForDocument(documentState),
      activity,
      dirty: activity !== "clean",
    };
  }, [documentState, isEditing, commitState]);
}

function activityForDocument(
  documentState: WorkspaceDocumentState | null,
  isEditing: boolean,
  commitState: WorkspaceCommitState,
): DocumentActivity {
  if (documentState?.dirty) return "dirty";
  if (isEditing) return "editing";
  if (commitState !== "idle") return "committing";
  return "clean";
}

function filenameForDocument(state: WorkspaceDocumentState | null): string {
  const saveTarget = state?.saveTarget;
  if (!saveTarget) return "Untitled";

  return saveTarget.split(/[\\/]/).filter(Boolean).at(-1) ?? "Untitled";
}
