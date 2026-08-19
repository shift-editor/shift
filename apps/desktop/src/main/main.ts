import { App } from "./app/App";
import { electronNativeDialogs } from "./dialogs/electronNativeDialogs";
import { scriptedNativeDialogs } from "./dialogs/scriptedNativeDialogs";

const nativeDialogs =
  process.env.NODE_ENV === "test" && process.env.SHIFT_E2E_NATIVE_DIALOGS === "1"
    ? scriptedNativeDialogs
    : electronNativeDialogs;
const shiftApp = new App(nativeDialogs);
shiftApp.start();
