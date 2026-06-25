import { app, BrowserWindow, ipcMain, MessageChannelMain, type WebContents } from "electron";
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
import { DocumentClient } from "../document/DocumentClient";
import { AppLifecycle } from "./AppLifecycle";
import { WindowManager } from "../windows/WindowManager";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import { WorkspaceSession } from "../workspace/WorkspaceSession";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import { showOpenFontDialog } from "../document/openFontDialog";

const APP_NAME = "Shift";
type RendererRoute = "launcher" | "workspace";

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
  #workspaces = new WorkspaceManager();
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
      documentForWindow: (window) =>
        this.#workspaces.getForBrowserWindow(window.window)?.document ?? null,
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

      const window = this.#createWindow();
      this.#loadRenderer(window, "launcher");

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

  #loadRenderer(window: Window, route: RendererRoute) {
    const source = getRendererSource();
    const hash = route === "workspace" ? "/home" : "/launcher";
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
    ipc.handle(ipcMain, "workspace.create", async (event) => {
      await this.#createWorkspaceForSender(event.sender);
    });
    ipc.handle(ipcMain, "workspace.open", async (event) => {
      await this.#openWorkspaceForSender(event.sender);
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
    };
  }

  async #createWorkspaceForSender(sender: WebContents): Promise<void> {
    await this.#createWorkspaceFromWindow(this.#requireWindowForWebContents(sender));
  }

  async #openWorkspaceForSender(sender: WebContents): Promise<void> {
    await this.#openWorkspaceFromWindow(this.#requireWindowForWebContents(sender));
  }

  async #createWorkspaceFromWindow(opener: Window): Promise<void> {
    const { session, state } = await this.#createWorkspaceSession((workspaceProcess) =>
      workspaceProcess.createWorkspace(),
    );
    this.#openWorkspaceWindow(opener, session, state);
  }

  async #openWorkspaceFromWindow(opener: Window): Promise<void> {
    const openPath = await showOpenFontDialog(opener);
    if (!openPath) return;

    const { session, state } = await this.#createWorkspaceSession((workspaceProcess) =>
      workspaceProcess.openWorkspace(openPath),
    );
    this.#openWorkspaceWindow(opener, session, state);
  }

  async #createWorkspaceSession(
    load: (workspaceProcess: WorkspaceProcess) => Promise<WorkspaceDocumentState>,
  ): Promise<{ session: WorkspaceSession; state: WorkspaceDocumentState }> {
    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#requireDocumentsRoot());

    try {
      await workspaceProcess.whenReady();
      const state = await load(workspaceProcess);
      const existing = this.#workspaces.get(state.documentId);
      if (existing) {
        workspaceProcess.stop();
        existing.document.acceptState(state);
        return { session: existing, state };
      }

      const session = new WorkspaceSession({
        workspaceId: state.documentId,
        workspaceProcess,
        documentClient: new DocumentClient(),
        applicationName: () => this.applicationName,
      });

      session.document.acceptState(state);
      this.#workspaces.register(session);
      return { session, state };
    } catch (error) {
      workspaceProcess.stop();
      throw error;
    }
  }

  #openWorkspaceWindow(
    opener: Window,
    session: WorkspaceSession,
    state: WorkspaceDocumentState,
  ): void {
    const closeOpener = this.#workspaces.getForBrowserWindow(opener.window) === null;
    const workspaceWindow = this.#createWindow();
    this.#workspaces.attachWindow(session.workspaceId, workspaceWindow);
    session.document.acceptState(state);
    this.#loadRenderer(workspaceWindow, "workspace");
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
