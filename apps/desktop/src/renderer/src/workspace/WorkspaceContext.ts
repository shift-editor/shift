import { createContext, useContext } from "react";
import type { Editor } from "@shift/editor";
import type { Font } from "@shift/editor/model";
import type { FontSession } from "@/types/fontSession";
import type { Workspace } from "./Workspace";

export const FontSessionContext = createContext<FontSession | null>(null);
export const WorkspaceContext = createContext<Workspace | null>(null);

export function useFontSession(): FontSession {
  const session = useContext(FontSessionContext);
  if (!session) throw new Error("useFontSession must be used within a FontSessionProvider");

  return session;
}

export function useEditor(): Editor {
  return useFontSession().editor;
}

export function useFont(): Font {
  return useFontSession().font;
}
