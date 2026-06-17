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
import { DocumentSession } from "../document/DocumentSession";
import { DocumentClient } from "../document/DocumentClient";
import { AppLifecycle } from "./AppLifecycle";

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
  readonly #lifecycle: AppLifecycle;

  #workingWindow: Window | null = null;
  #commands = new CommandRegistry();

  #appIcon = new AppIcon();
  #applicationMenu = new ApplicationMenu(this.#appIcon.path(), (id) => {
    // Menu/accelerator commands run detached, so a failure (e.g. a save that
    // throws) has nowhere to propagate — catch and surface it here.
    void this.#commands.run(id, this.#commandContext()).catch((error) => {
      this.#log.error("menu command failed", id, error);
    });
  });

  #workspace = new WorkspaceProcess();
  #documentClient = new DocumentClient();
  #document = new DocumentSession({
    document: this.#documentClient,
    activeWindow: () => this.#workingWindow,
    applicationName: () => this.applicationName,
  });

  constructor(log: ShiftLogger = createShiftLogger("app")) {
    this.#log = log;
    this.#lifecycle = new AppLifecycle({
      document: this.#document,
      log: this.#log,
    });
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
    this.#lifecycle.start();
    app.setName(this.applicationName);

    if (!app.isPackaged) {
      app.setPath("userData", path.join(app.getPath("appData"), this.applicationName));
    }

    void app.whenReady().then(() => {
      this.#log.info("running when ready callback");

      const documentsRoot = path.join(app.getPath("userData"), "working-documents");
      this.#workspace.start(documentsRoot);
      this.#workspace.onDocumentChanged((state) => this.#document.acceptState(state));

      this.#appIcon.install();
      this.#applicationMenu.install();

      this.#workingWindow = new Window({
        preloadPath: path.join(__dirname, "preload.js"),
      });
      this.#lifecycle.registerWindow(this.#workingWindow, {
        onClosed: () => {
          this.#log.info("working window closed");
          this.#workingWindow = null;
          this.#documentClient.dispose();
        },
      });

      this.#loadRenderer();

      this.#log.info("finished when ready callback");
    });
    app.on("will-quit", () => {
      this.#log.info("will quit: disposing app services");
      this.#documentClient.dispose();
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
    ipc.handle(ipcMain, "document.connect", (event) => {
      this.#log.info("document connect requested");
      const { port1, port2 } = new MessageChannelMain();

      this.#documentClient.connect(port1);
      event.sender.postMessage("document.port", null, [port2]);
      this.#log.info("document port sent to renderer");
    });
    ipc.handle(ipcMain, "workspace.connect", async (event) => {
      this.#log.info("workspace connect requested");
      const { port1, port2 } = new MessageChannelMain();

      try {
        await this.#workspace.whenReady();
        await this.#workspace.connectSyncLane(port1);
      } catch (error) {
        this.#log.error("workspace connect failed", error);
        port1.close();
        port2.close();
        throw error;
      }

      event.sender.postMessage("workspace.port", null, [port2]);
      this.#log.info("workspace port sent to renderer");
    });
  }

  #commandContext(): CommandContext {
    return {
      document: {
        create: () => this.#document.create(),
        open: () => this.#document.open(),
        save: () => this.#document.save(),
        saveAs: () => this.#document.saveAs(),
      },
      windows: {
        active: () => this.#workingWindow,
      },
    };
  }
}
