export type FocusZone = "canvas" | "sidebar" | "toolbar" | "modal";

export interface FocusZoneState {
  activeZone: FocusZone;
  focusLock: boolean;
}
