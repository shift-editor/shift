import { createContext, useContext } from "react";
import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { FontSession } from "./FontSession";
import type { Workspace } from "./Workspace";

export const FontSessionContext = createContext<FontSession | null>(null);
export const WorkspaceContext = createContext<Workspace | null>(null);

export function useFontSession(): FontSession {
  const session = useContext(FontSessionContext);
  if (!session) throw new Error("useFontSession must be used within a FontSessionProvider");

  return session;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("the current font session has no authored workspace");

  return workspace;
}

export function useEditor(): Editor {
  return useFontSession().editor;
}

export function useFont(): Font {
  return useFontSession().font;
}
