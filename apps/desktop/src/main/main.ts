import { app } from "electron";
import { App } from "./app/App";
import { electronNativeDialogs } from "./dialogs/electronNativeDialogs";
import { scriptedNativeDialogs } from "./dialogs/scriptedNativeDialogs";

// WebGPU, which draws the glyph grid and canvas, needs Chromium's Vulkan
// backend on Linux; Chromium leaves it off there, so no GPU adapter appears.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan");

const nativeDialogs =
  process.env.NODE_ENV === "test" && process.env.SHIFT_E2E_NATIVE_DIALOGS === "1"
    ? scriptedNativeDialogs
    : electronNativeDialogs;
const shiftApp = new App(nativeDialogs);
shiftApp.start();
