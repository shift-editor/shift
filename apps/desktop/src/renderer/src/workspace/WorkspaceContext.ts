import { createContext, useContext } from "react";
import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { Workspace } from "./Workspace";

export const WorkspaceContext = createContext<Workspace | null>(null);

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
