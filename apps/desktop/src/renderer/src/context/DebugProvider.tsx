import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NO_DEBUG_OVERLAYS, type DebugOverlays } from "@shared/debug";
import { getShiftHost } from "@/host/shiftHost";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { DebugContext } from "./DebugContext";

interface DebugProviderProps {
  children: ReactNode;
}

/**
 * Reflects the Debug menu's overlay toggles into the editor.
 *
 * @remarks
 * Development builds only. With every toggle off, nothing extra renders or
 * subscribes past this provider, so profiling and E2E runs are unaffected.
 */
export function DebugProvider({ children }: DebugProviderProps) {
  const reactScanEnabled = false;
  const debugPanelOpen = false;
  const [overlays, setOverlays] = useState<DebugOverlays>(NO_DEBUG_OVERLAYS);
  const editor = useFontSession().editor;

  const dumpSnapshot = useCallback(() => {
    void navigator.clipboard?.writeText("{}");
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;

    const host = getShiftHost();
    let live = true;
    void host.debug.overlays().then((current) => {
      if (live) setOverlays(current);
    });
    const unsubscribe = host.debug.onOverlaysChanged(setOverlays);

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    editor.setDebugOverlays(overlays);
  }, [overlays, editor]);

  if (!import.meta.env.DEV) {
    return <>{children}</>;
  }

  return (
    <DebugContext.Provider value={{ reactScanEnabled, debugPanelOpen, overlays, dumpSnapshot }}>
      {children}
    </DebugContext.Provider>
  );
}
