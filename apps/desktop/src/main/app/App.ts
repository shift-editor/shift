import { app, ipcMain, MessageChannelMain } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { Window } from "../windows/Window";
import { getRendererSource } from "../utils";
import * as ipc from "../../shared/ipc/main";
import { AppIcon } from "./AppIcon";
import { CommandRegistry, type CommandContext } from "../commands/Command";
import { registerCommands } from "../commands/Commands";
import { ApplicationMenu } from "../menu/ApplicationMenu";
import { createShiftLogger, type ShiftLogger } from "../logging";
import { WorkspaceProcess } from "../workspace/WorkspaceProcess";

const APP_NAME = "Shift";

/**
 * Owns Electron app startup and the first main-process service graph.
 *
 * @remarks
 * `App` wires the shell-level pieces together: command registration, IPC
 * registration, working-window creation, and renderer loading. Domain behavior
 * should live behind the services it creates rather than accumulating here.
 */
export class App {
  readonly #log: ShiftLogger;

  #workingWindow: Window | null = null;
  #commands = new CommandRegistry();

  #appIcon = new AppIcon();
  #applicationMenu = new ApplicationMenu(this.#appIcon.path());

  #workspace = new WorkspaceProcess();

  constructor(log: ShiftLogger = createShiftLogger("app")) {
    this.#log = log;
  }

  get applicationName(): string {
    return app.isPackaged ? APP_NAME : `${APP_NAME} Dev`;
  }

  /**
   * Starts Electron after installer-startup handling has completed.
   *
   * @remarks
   * Commands and IPC handlers are registered before the window exists so
   * renderer calls can arrive as soon as preload exposes `window.shiftHost`.
   * Command handlers resolve the active window from a fresh context at run time.
   */
  start(): void {
    this.#log.info("starting");

    if (started) {
      this.#log.info("app already started, quitting");
      app.quit();
      return;
    }

    this.#registerCommands();
    this.#registerIpcHandlers();
    app.setName(this.applicationName);

    if (!app.isPackaged) {
      app.setPath("userData", path.join(app.getPath("appData"), this.applicationName));
    }

    void app.whenReady().then(() => {
      this.#log.info("running when ready callback");

      const documentsRoot = path.join(app.getPath("userData"), "working-documents");
      this.#workspace.start(documentsRoot);

      this.#appIcon.install();
      this.#applicationMenu.install();

      this.#workingWindow = new Window({
        preloadPath: path.join(__dirname, "preload.js"),
      });

      this.#loadRenderer();

      this.#log.info("finished when ready callback");
    });

    app.on("will-quit", () => {
      this.#workspace.stop();
    });
  }

  #loadRenderer() {
    if (!this.#workingWindow) return;

    const source = getRendererSource();
    if (source.type === "url") {
      // in dev load the renderer from vite at MAIN_WINDOW_VITE_DEV_SERVER_URL
      this.#log.info("loading dev server url", { url: source.source });
      this.#workingWindow.window.loadURL(source.source);
      return;
    }

    // otherwise this is the build, load the built file directly
    this.#log.info("loading build file at", { path: source.source });
    this.#workingWindow.window.loadFile(source.source);
  }

  #registerCommands(): void {
    registerCommands(this.#commands);
  }

  #registerIpcHandlers(): void {
    ipc.handle(ipcMain, "commands.run", (_event, id) => {
      return this.#commands.run(id, this.#commandContext());
    });
    ipc.handle(ipcMain, "workspace.connect", async (event) => {
      const { port1, port2 } = new MessageChannelMain();

      try {
        await this.#workspace.whenReady();
        await this.#workspace.connectSyncLane(port1);
      } catch (error) {
        port1.close();
        port2.close();
        throw error;
      }

      event.sender.postMessage("workspace.port", null, [port2]);
    });
  }

  #commandContext(): CommandContext {
    return {
      windows: {
        active: () => this.#workingWindow,
      },
    };
  }
}
