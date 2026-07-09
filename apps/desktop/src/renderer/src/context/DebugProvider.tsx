import { useCallback, useEffect, type ReactNode } from "react";
import { isDev } from "@/lib/utils/utils";
import { useEditor } from "@/workspace/WorkspaceContext";
import { DEFAULT_DEBUG_OVERLAYS, DebugContext } from "./DebugContext";

interface DebugProviderProps {
  children: ReactNode;
}

export function DebugProvider({ children }: DebugProviderProps) {
  const reactScanEnabled = false;
  const debugPanelOpen = false;
  const overlays = DEFAULT_DEBUG_OVERLAYS;
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
