import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { electronSystemClipboard } from "@/lib/clipboard";
import { getShiftHost } from "@/host/shiftHost";
import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import { Workspace } from "./Workspace";

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useMemo(
    () =>
      new Workspace({
        host: getShiftHost(),
        clipboard: electronSystemClipboard,
      }),
    [],
  );

  useEffect(() => {
    return () => workspace.dispose();
  }, [workspace]);

  useEffect(() => {
    if (typeof __PLAYWRIGHT__ === "undefined" || !__PLAYWRIGHT__) return undefined;

    const exposed: ShiftPlaywrightApi = {
      getEditor: () => workspace.editor,
      getWorkspace: () => workspace,
      getFont: () => workspace.font,
    };

    window.__shift = exposed;

    return () => {
      delete window.__shift;
    };
  }, [workspace]);

  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  return workspace;
}

export function useEditor(): Editor {
  return useWorkspace().editor;
}

export function useFont(): Font {
  return useWorkspace().font;
}

declare const __PLAYWRIGHT__: boolean | undefined;

interface ShiftPlaywrightApi {
  readonly getEditor: () => Editor;
  readonly getWorkspace: () => Workspace;
  readonly getFont: () => Font;
}

declare global {
  interface Window {
    __shift?: ShiftPlaywrightApi;
  }
}
