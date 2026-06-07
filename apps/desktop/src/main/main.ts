import { app } from "electron";
import started from "electron-squirrel-startup";
import { createShiftLogger } from "./logging";
import { AppLifecycle, DocumentState, MenuManager, WindowManager } from "./managers";

const log = createShiftLogger("main");

if (started) {
  log.info("quitting during squirrel startup");
  app.quit();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    log.info("quitting because another instance is active");
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
    log.info("initializing app lifecycle");
    appLifecycle.initialize();
  }
}
