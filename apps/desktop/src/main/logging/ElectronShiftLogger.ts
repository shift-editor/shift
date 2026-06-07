import log from "electron-log/main";
import type { ShiftLogger } from "../../shared/logging";

log.initialize();

/**
 * Returns an electron-log scope for one desktop subsystem.
 *
 * @remarks
 * Importing this module initializes electron-log for the current Electron
 * process. Keep callers on this factory so the logging backend can change
 * without changing service constructors.
 *
 * @param scope - stable subsystem label attached to emitted log entries.
 * @returns a scoped logger whose lifetime is managed by electron-log.
 */
export function createShiftLogger(scope: string): ShiftLogger {
  return log.scope(scope);
}
