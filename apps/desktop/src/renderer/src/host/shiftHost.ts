import type { ShiftHost } from "@shared/host/ShiftHost";

/**
 * Returns the Shift host exposed by Electron preload.
 *
 * @returns the renderer-facing app shell API.
 * @throws {Error} when the renderer is running without the expected preload bridge.
 */
export function getShiftHost(): ShiftHost {
  const host = window.shiftHost;

  if (!host) {
    throw new Error("window.shiftHost is not available. Is the Electron preload loaded?");
  }

  return host;
}

/**
 * Shared renderer access point for app-shell calls.
 *
 * @remarks
 * Import this instead of reading `window.shiftHost` directly so missing preload
 * wiring fails once at the boundary instead of forcing optional checks at every
 * call site.
 */
export const shiftHost = getShiftHost();
