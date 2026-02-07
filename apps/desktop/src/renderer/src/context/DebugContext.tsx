import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { isDev } from "@/lib/utils/utils";
import { enableReactScan, disableReactScan } from "@/lib/debug/reactScan";
import { getEditor } from "@/store/store";
import type { DebugOverlays } from "@/types/electron";

const DEFAULT_OVERLAYS: DebugOverlays = {
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
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
  const [reactScanEnabled, setReactScanEnabled] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [overlays, setOverlays] = useState<DebugOverlays>(DEFAULT_OVERLAYS);

  useEffect(() => {
    if (!isDev) return undefined;

    window.electronAPI?.getDebugState().then((state) => {
      setReactScanEnabled(state.reactScanEnabled);
      setDebugPanelOpen(state.debugPanelOpen);
      if (state.overlays) {
        setOverlays(state.overlays);
      }
      if (state.reactScanEnabled) {
        void enableReactScan();
      }
    });

    const unsubscribeReactScan = window.electronAPI?.onDebugReactScan((enabled) => {
      setReactScanEnabled(enabled);
      if (enabled) {
        void enableReactScan();
      } else {
        disableReactScan();
      }
    });

    const unsubscribePanel = window.electronAPI?.onDebugPanel((open) => {
      setDebugPanelOpen(open);
    });

    const unsubscribeDump = window.electronAPI?.onDebugDumpSnapshot(() => {
      dumpSnapshot();
    });

    const unsubscribeOverlays = window.electronAPI?.onDebugOverlays((newOverlays) => {
      setOverlays(newOverlays);
    });

    return () => {
      unsubscribeReactScan?.();
      unsubscribePanel?.();
      unsubscribeDump?.();
      unsubscribeOverlays?.();
    };
  }, []);

  const dumpSnapshot = () => {
    const editor = getEditor();
    const glyph = editor.getGlyph();
    if (!glyph) {
      return;
    }

    const json = JSON.stringify(glyph, null, 2);

    window.electronAPI?.clipboardWriteText(json);
  };

  useEffect(() => {
    getEditor().setDebugOverlays(overlays);
  }, [overlays]);

  if (!isDev) {
    return <>{children}</>;
  }

  return (
    <DebugContext.Provider value={{ reactScanEnabled, debugPanelOpen, overlays, dumpSnapshot }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug(): DebugContextValue {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error("useDebug must be used within a DebugProvider (dev mode only)");
  }
  return context;
}

export function useDebugSafe(): DebugContextValue | null {
  return useContext(DebugContext);
}
