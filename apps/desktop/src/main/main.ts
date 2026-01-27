import { app } from "electron";
import started from "electron-squirrel-startup";
import {
  AppLifecycle,
  DocumentState,
  MenuManager,
  WindowManager,
} from "./managers";

if (started) {
  app.quit();
}

const documentState = new DocumentState();
const windowManager = new WindowManager(documentState);
const menuManager = new MenuManager(documentState, windowManager);
const appLifecycle = new AppLifecycle(documentState, windowManager, menuManager);

appLifecycle.initialize();
