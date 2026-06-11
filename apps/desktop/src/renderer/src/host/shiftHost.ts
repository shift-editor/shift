import type { ShiftHost } from "@shared/host/ShiftHost";

/**
 * Returns the Shift host exposed by Electron preload.
 *
 * @remarks
 * Resolved lazily so modules can import this boundary without requiring the
 * preload bridge at import time (tests, web). Call it at use time instead of
 * reading `window.shiftHost` directly so missing preload wiring fails with
 * one clear error.
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
