import { useEffect, type ReactNode } from "react";
import type { Workspace } from "./Workspace";
import { getWorkspace } from "./runtime";
import { WorkspaceContext } from "./WorkspaceContext";
import { getShiftHost } from "@/host/shiftHost";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = getWorkspace();

  useEffect(() => {
    window.shift = workspace;

    return () => {
      delete window.shift;
    };
  }, [workspace]);

  useEffect(() => {
    return getShiftHost().commands.onRunRendererCommand((id) => {
      workspace.editor.runRendererCommand(id);
    });
  }, [workspace]);

  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

declare global {
  interface Window {
    /** Active workspace session for renderer-console experiments and e2e tests. */
    shift?: Workspace;
  }
}
