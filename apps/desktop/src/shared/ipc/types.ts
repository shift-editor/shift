export type ThemeName = "light" | "dark" | "system";

export interface DebugOverlays {
  tightBounds: boolean;
  hitRadii: boolean;
  segmentBounds: boolean;
  glyphBbox: boolean;
}

export interface Debug {
  reactScanEnabled: boolean;
  debugPanelOpen: boolean;
  overlays: DebugOverlays;
}
