export type ThemeName = "light" | "dark" | "system";

export interface DebugOverlays {
  tightBounds: boolean;
  hitRadii: boolean;
  segmentBounds: boolean;
  glyphBbox: boolean;
}

export interface DebugState {
  reactScanEnabled: boolean;
  debugPanelOpen: boolean;
  overlays: DebugOverlays;
}
