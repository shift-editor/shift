import { app } from "electron";
import path from "node:path";
import { shiftProductName } from "./release";

async function start(): Promise<void> {
  const applicationName = app.isPackaged ? shiftProductName : `${shiftProductName} Dev`;
  app.setName(applicationName);

  if (!app.commandLine.hasSwitch("user-data-dir")) {
    app.setPath("userData", path.join(app.getPath("appData"), applicationName));
  }

  const { App } = await import("./app/App");
  const shiftApp = new App();
  shiftApp.start();
}

void start();
