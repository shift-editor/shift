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
    void navigator.clipboard?.writeText("{}");
  }, []);

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
