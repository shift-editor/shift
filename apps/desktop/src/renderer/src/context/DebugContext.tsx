import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { isDev } from "@/lib/utils/utils";
import { enableReactScan, disableReactScan } from "@/lib/debug/reactScan";
import { getEditor } from "@/store/store";
import type { DebugOverlays } from "@shared/ipc/types";

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
  const [reactScanEnabled, setReactScanEnabled] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [overlays, setOverlays] = useState<DebugOverlays>(DEFAULT_OVERLAYS);

  const dumpSnapshot = useCallback(() => {
    const editor = getEditor();
    const glyph = editor.glyph.peek();
    console.log(glyph);
    if (!glyph) {
      return;
    }

    const json = JSON.stringify(glyph, null, 2);

    window.electronAPI?.clipboardWriteText(json);
  }, []);

  const dumpSnapshotRef = useRef(dumpSnapshot);
  dumpSnapshotRef.current = dumpSnapshot;

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
      dumpSnapshotRef.current();
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

export function useDebugSafe(): DebugContextValue | null {
  return useContext(DebugContext);
}
