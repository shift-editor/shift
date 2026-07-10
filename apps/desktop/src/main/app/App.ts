import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  MessageChannelMain,
  type WebContents,
} from "electron";
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
import { AppLifecycle } from "./AppLifecycle";
import { WindowManager } from "../windows/WindowManager";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import { WorkspaceSession } from "../workspace/WorkspaceSession";
import { showOpenFontDialog } from "../document/openFontDialog";

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

  #commands = new CommandRegistry();
  #windows = new WindowManager();
  #workspaces = new WorkspaceManager({
    documentsRoot: () => this.#requireDocumentsRoot(),
    applicationName: () => this.applicationName,
  });
  #documentsRoot: string | null = null;

  #appIcon = new AppIcon();
  #applicationMenu = new ApplicationMenu(this.#appIcon.path(), (id) => {
    // Menu/accelerator commands run detached, so a failure (e.g. a save that
    // throws) has nowhere to propagate — catch and surface it here.
    void this.#commands.run(id, this.#commandContext()).catch((error) => {
      this.#log.error("menu command failed", id, error);
    });
  });

  constructor(log: ShiftLogger = createShiftLogger("app")) {
    this.#log = log;
    this.#lifecycle = new AppLifecycle({
      documentForWindow: (window) => {
        const session = this.#workspaces.getForBrowserWindow(window.window);
        if (!session || session.windows.size > 1) return null;

        return session.document;
      },
      documents: () => this.#workspaces.list().map((session) => session.document),
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

      this.#documentsRoot = path.join(app.getPath("userData"), "working-documents");

      this.#appIcon.install();
      this.#applicationMenu.install();

      this.#openLauncher();

      this.#log.info("finished when ready callback");
    });
    app.on("will-quit", () => {
      this.#log.info("will quit: disposing app services");
      for (const session of this.#workspaces.list()) {
        this.#workspaces.unregister(session.workspaceId);
      }
    });
  }

  #createWindow(): Window {
    const window = new Window({
      preloadPath: path.join(__dirname, "preload.js"),
    });
    this.#windows.add(window);

    this.#lifecycle.registerWindow(window, {
      onClosed: () => {
        this.#log.info("working window closed");
        const session = this.#workspaces.getForBrowserWindow(window.window);
        this.#workspaces.detachWindow(window);
        if (session?.windows.size === 0) {
          this.#workspaces.unregister(session.workspaceId);
        }
        this.#windows.remove(window);
      },
    });

    return window;
  }

  #openLauncher(): Window {
    const window = this.#createWindow();
    this.#loadLauncher(window);
    return window;
  }

  #loadLauncher(window: Window): void {
    this.#loadRenderer(window, "/launcher");
  }

  #loadWorkspace(window: Window): void {
    this.#loadRenderer(window, "/home");
  }

  #loadRenderer(window: Window, hash: string): void {
    const source = getRendererSource();
    if (source.type === "url") {
      // in dev load the renderer from vite at MAIN_WINDOW_VITE_DEV_SERVER_URL
      const url = new URL(source.source);
      url.hash = hash;
      this.#log.info("loading dev server url", { url: url.toString() });
      window.window.loadURL(url.toString());
      return;
    }

    // otherwise this is the build, load the built file directly
    this.#log.info("loading build file at", { path: source.source });
    window.window.loadFile(source.source, { hash });
  }

  #registerCommands(): void {
    registerCommands(this.#commands);
  }

  #registerIpcHandlers(): void {
    ipc.handle(ipcMain, "commands.run", (_event, id) => {
      return this.#commands.run(id, this.#commandContext());
    });
    ipc.handle(ipcMain, "clipboard.readText", () => {
      return clipboard.readText();
    });
    ipc.handle(ipcMain, "clipboard.writeText", (_event, text) => {
      clipboard.writeText(text);
    });
    ipc.handle(ipcMain, "document.connect", (event) => {
      this.#log.info("document connect requested");
      const session = this.#workspaceForSender(event.sender, "document.connect");
      const { port1, port2 } = new MessageChannelMain();

      session.documentClient.connect(port1);
      event.sender.postMessage("document.port", null, [port2]);
      this.#log.info("document port sent to renderer");
    });
    ipc.handle(ipcMain, "workspace.connect", async (event) => {
      this.#log.info("workspace connect requested");
      const session = this.#workspaceForSender(event.sender, "workspace.connect");
      const { port1, port2 } = new MessageChannelMain();

      try {
        await session.workspaceProcess.whenReady();
        await session.workspaceProcess.connectSyncLane(port1);
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
        create: async () => {
          const window = this.#windows.activeWindow();
          if (!window) return;

          await this.#createWorkspaceFromWindow(window);
        },
        open: async () => {
          const window = this.#windows.activeWindow();
          if (!window) return;

          await this.#openWorkspaceFromWindow(window);
        },
        hasWorkspace: () => this.#activeWorkspaceSession() !== null,
        save: async () => {
          await this.#requireActiveWorkspaceSession("file.save").document.save();
        },
        saveAs: async () => {
          await this.#requireActiveWorkspaceSession("file.saveAs").document.saveAs();
        },
      },
      windows: {
        active: () => this.#windows.activeWindow(),
      },
      renderer: {
        run: (id) => {
          const session = this.#activeWorkspaceSession();
          if (!session) return;

          session.activeWindow()?.runRendererCommand(id);
        },
      },
    };
  }

  async #createWorkspaceFromWindow(opener: Window): Promise<void> {
    const session = await this.#workspaces.createUntitled();
    this.#openWorkspaceWindow(opener, session);
  }

  async #openWorkspaceFromWindow(opener: Window): Promise<void> {
    const openPath = await showOpenFontDialog(opener);
    if (!openPath) return;

    const session = await this.#workspaces.openPath(openPath);
    if (this.#focusExistingWorkspaceWindow(opener, session)) return;

    this.#openWorkspaceWindow(opener, session);
  }

  #focusExistingWorkspaceWindow(opener: Window, session: WorkspaceSession): boolean {
    const existingWindow = session.activeWindow();
    if (!existingWindow) return false;

    existingWindow.focus();
    if (this.#workspaces.getForBrowserWindow(opener.window) === null) opener.close();
    return true;
  }

  #openWorkspaceWindow(opener: Window, session: WorkspaceSession): void {
    const closeOpener = this.#workspaces.getForBrowserWindow(opener.window) === null;
    const workspaceWindow = this.#createWindow();
    this.#workspaces.attachWindow(session.workspaceId, workspaceWindow);
    this.#loadWorkspace(workspaceWindow);
    if (closeOpener) opener.close();
  }

  #workspaceForSender(sender: WebContents, operation: string): WorkspaceSession {
    const window = this.#requireWindowForWebContents(sender);
    const session = this.#workspaces.getForBrowserWindow(window.window);
    if (!session) {
      throw new Error(`${operation} requires a workspace-bound window`);
    }

    return session;
  }

  #activeWorkspaceSession(): WorkspaceSession | null {
    const window = this.#windows.activeWindow();
    return window ? this.#workspaces.getForBrowserWindow(window.window) : null;
  }

  #requireActiveWorkspaceSession(operation: string): WorkspaceSession {
    const session = this.#activeWorkspaceSession();
    if (!session) throw new Error(`${operation} requires an active workspace window`);
    return session;
  }

  #requireDocumentsRoot(): string {
    if (!this.#documentsRoot) throw new Error("documents root is not ready");
    return this.#documentsRoot;
  }

  #requireWindowForWebContents(webContents: WebContents): Window {
    const browserWindow = BrowserWindow.fromWebContents(webContents);
    const window = browserWindow ? this.#windows.windowForBrowserWindow(browserWindow) : null;
    if (!window) {
      throw new Error("workspace request came from an unknown window");
    }

    return window;
  }
}
