import type { ShiftHost } from "@shared/host/ShiftHost";

export type { ShiftHost } from "@shared/host/ShiftHost";

declare global {
  interface Window {
    shiftHost?: ShiftHost;
  }
}

export {};
