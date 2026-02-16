import { app } from "electron";
import started from "electron-squirrel-startup";
import { AppLifecycle, DocumentState, MenuManager, WindowManager } from "./managers";

if (started) {
  app.quit();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    const documentState = new DocumentState();
    const windowManager = new WindowManager(documentState);
    const menuManager = new MenuManager(documentState, windowManager);
    const appLifecycle = new AppLifecycle(documentState, windowManager, menuManager);

    app.on("second-instance", (_event, argv) => {
      appLifecycle.handleSecondInstance(argv);
    });

    appLifecycle.handleLaunchArgs(process.argv);
    appLifecycle.initialize();
  }
}
