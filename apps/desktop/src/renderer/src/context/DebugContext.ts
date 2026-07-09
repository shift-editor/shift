import { createContext, useContext } from "react";
import type { DebugOverlays } from "@/types/uiState";

export const DEFAULT_DEBUG_OVERLAYS: DebugOverlays = {
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
  glyphBbox: false,
};

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
