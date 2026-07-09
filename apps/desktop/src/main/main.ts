import { App } from "./app/App";
import type { ShiftTestRuntime } from "./types/testRuntime";

const shiftApp = new App();

if (process.env.NODE_ENV === "test") {
  globalThis.shiftTest = {
    openPath: (path) => shiftApp.openPath(path),
  } satisfies ShiftTestRuntime;
}

shiftApp.start();
