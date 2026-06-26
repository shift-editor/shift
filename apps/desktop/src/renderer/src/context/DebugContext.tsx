import { createContext, useCallback, useContext, useEffect, ReactNode } from "react";
import { isDev } from "@/lib/utils/utils";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { DebugOverlays } from "@/types/uiState";

const DEFAULT_OVERLAYS: DebugOverlays = {
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
  glyphBbox: false,
};

interface DebugContextValue {
  reactScanEnabled: boolean;
  debugPanelOpen: boolean;
  overlays: DebugOverlays;
  dumpSnapshot: () => void;
}

const DebugContext = createContext<DebugContextValue | null>(null);

interface DebugProviderProps {
  children: ReactNode;
}

export function DebugProvider({ children }: DebugProviderProps) {
  const reactScanEnabled = false;
  const debugPanelOpen = false;
  const overlays = DEFAULT_OVERLAYS;
  const editor = useEditor();

  const dumpSnapshot = useCallback(() => {
    const glyph = editor.glyph.peek();
    if (!glyph) {
      return;
    }

    const json = JSON.stringify(glyph, null, 2);
    void navigator.clipboard?.writeText(json);
  }, [editor]);

  useEffect(() => {
    editor.setDebugOverlays(overlays);
  }, [editor, overlays]);

  if (!isDev) {
    return <>{children}</>;
  }

  return (
    <DebugContext.Provider value={{ reactScanEnabled, debugPanelOpen, overlays, dumpSnapshot }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebugSafe(): DebugContextValue | null {
  return useContext(DebugContext);
}
