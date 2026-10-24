import { createContext, useContext } from "react";
import type { DebugOverlays } from "@shared/debug";

export interface DebugContextValue {
  reactScanEnabled: boolean;
  debugPanelOpen: boolean;
  overlays: DebugOverlays;
  dumpSnapshot: () => void;
}

export const DebugContext = createContext<DebugContextValue | null>(null);

export function useDebugSafe(): DebugContextValue | null {
  return useContext(DebugContext);
}
