/** Main-process capabilities exposed to Playwright builds. */
export interface ShiftTestRuntime {
  /**
   * Opens a source path through the application workspace flow and resolves after window creation.
   *
   * @param path - Font or Shift package path to open.
   */
  openPath(path: string): Promise<void>;
}

declare global {
  var shiftTest: ShiftTestRuntime | undefined;
}
