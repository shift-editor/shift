/**
 * Canvas overlays the Debug menu toggles in development builds.
 *
 * @remarks
 * Main owns the state and every window reflects it. Nothing is persisted, so
 * each launch, including profiling and E2E runs, starts with every overlay off.
 */
export type DebugOverlays = {
  /** The floating toolbar's dock zones, its target and the pointer that steers it. */
  toolbarZones: boolean;
  tightBounds: boolean;
  hitRadii: boolean;
  segmentBounds: boolean;
  glyphBbox: boolean;
};

export type DebugOverlayId = keyof DebugOverlays;

export const NO_DEBUG_OVERLAYS: DebugOverlays = {
  toolbarZones: false,
  tightBounds: false,
  hitRadii: false,
  segmentBounds: false,
  glyphBbox: false,
};

/** Debug menu entries, in menu order. */
export const DEBUG_OVERLAY_ITEMS: readonly { id: DebugOverlayId; label: string }[] = [
  { id: "toolbarZones", label: "Toolbar Dock Zones" },
  { id: "tightBounds", label: "Tight Bounds" },
  { id: "hitRadii", label: "Hit Radii" },
  { id: "segmentBounds", label: "Segment Bounds" },
  { id: "glyphBbox", label: "Glyph Bounding Box" },
];
