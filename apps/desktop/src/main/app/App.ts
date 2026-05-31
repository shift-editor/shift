import { app, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { Window } from "../windows/Window";
import { getRendererSource } from "../utils";
import * as ipc from "../../shared/ipc/main";
import { AppIcon } from "./AppIcon";
import { CommandRegistry, type CommandContext } from "../commands/Command";
import { registerCommands } from "../commands/Commands";
import { ApplicationMenu } from "../menu/ApplicationMenu";

const applicationName = "Shift";

/**
 * Owns Electron app startup and the first main-process service graph.
 *
 * @remarks
 * `App` wires the shell-level pieces together: command registration, IPC
 * registration, working-window creation, and renderer loading. Domain behavior
 * should live behind the services it creates rather than accumulating here.
 */
export class App {
  #workingWindow: Window | null = null;
  #commands = new CommandRegistry();
  #appIcon = new AppIcon();
  #applicationMenu = new ApplicationMenu(this.#appIcon.path());

  constructor() {}

  /**
   * Starts Electron after installer-startup handling has completed.
   *
   * @remarks
   * Commands and IPC handlers are registered before the window exists so
   * renderer calls can arrive as soon as preload exposes `window.shiftHost`.
   * Command handlers resolve the active window from a fresh context at run time.
   */
  start(): void {
    if (started) {
      app.quit();
      return;
    }

    this.#registerCommands();
    this.#registerIpcHandlers();
    app.setName(applicationName);

    void app.whenReady().then(() => {
      this.#appIcon.install();
      this.#applicationMenu.install();

      this.#workingWindow = new Window({
        preloadPath: path.join(__dirname, "preload.js"),
      });

      this.#loadRenderer();
    });
  }

  #loadRenderer() {
    if (!this.#workingWindow) return;

    const source = getRendererSource();
    if (source.type === "url") {
      // in dev load the renderer from vite at MAIN_WINDOW_VITE_DEV_SERVER_URL
      this.#workingWindow.window.loadURL(source.source);
      return;
    }

    // otherwise this is the build, load the built file directly
    this.#workingWindow.window.loadFile(source.source);
  }

  #registerCommands(): void {
    registerCommands(this.#commands);
  }

  #registerIpcHandlers(): void {
    ipc.handle(ipcMain, "commands.run", (_event, id) => {
      return this.#commands.run(id, this.#commandContext());
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
