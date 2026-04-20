export type FocusZone = "canvas" | "sidebar" | "toolbar" | "modal";

export interface FocusZoneFocus {
  activeZone: FocusZone;
  focusLock: boolean;
}
