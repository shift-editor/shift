import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  MessageChannelMain,
  screen,
  type Rectangle,
  type WebContents,
} from "electron";
import path from "node:path";
import { Window } from "../windows/Window";
import { getRendererSource } from "../utils";
import * as ipc from "../../shared/ipc/main";
import { AppIcon } from "./AppIcon";
import { AboutWindow } from "../about/AboutWindow";
import { CommandRegistry, type CommandContext } from "../commands/Command";
import { FeedbackWindow } from "../feedback/FeedbackWindow";
import { registerCommands } from "../commands/Commands";
import { ApplicationMenu } from "../menu/ApplicationMenu";
import { createShiftLogger, type ShiftLogger } from "../logging";
import { AppLifecycle } from "./AppLifecycle";
import { WindowManager } from "../windows/WindowManager";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import type { FontSessionHost } from "../workspace/FontSessionHost";
import type { NativeDialogs } from "../dialogs/NativeDialogs";
import { electronNativeDialogs } from "../dialogs/electronNativeDialogs";
import { shiftProductName } from "../release";
import { AppUpdater } from "../update/AppUpdater";
import { isConvertiblePreviewPath } from "../../shared/workspace/previewConversion";

const SLUG_ATLAS_PROFILING_ENABLED =
  process.env.SHIFT_PROFILE_SLUG_ATLAS !== undefined &&
  process.env.SHIFT_PROFILE_SLUG_ATLAS !== "0";
const LAUNCHER_MIN_WIDTH = 800;

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
  readonly #nativeDialogs: NativeDialogs;
  readonly #aboutWindow: AboutWindow;
  readonly #feedbackWindow: FeedbackWindow;
  readonly #updater: AppUpdater;

  #commands = new CommandRegistry();
  #windows = new WindowManager();
  #workspaces: WorkspaceManager;
  #documentsRoot: string | null = null;
  #pendingOpenPaths: string[] = [];
  #previewConversions = new Map<string, Promise<void>>();
  #documentCrashDecisions = new Map<string, Promise<void>>();

  #appIcon = new AppIcon();
  #applicationMenu = new ApplicationMenu(
    (id, browserWindow) => {
      const window = browserWindow
        ? this.#windows.windowForBrowserWindow(browserWindow)
        : undefined;
      if (browserWindow && !window) return;

      // Menu/accelerator commands run detached, so a failure (e.g. a save that
      // throws) has nowhere to propagate — catch and surface it here.
      void this.#commands
        .run(id, this.#commandContext(window))
        .catch((error) => {
          this.#log.error("menu command failed", id, error);
        })
        .finally(() => {
          this.#applicationMenu.updateCommandStates();
        });
    },
    (id, browserWindow) => {
      const window = browserWindow
        ? this.#windows.windowForBrowserWindow(browserWindow)
        : undefined;
      if (browserWindow && !window) return false;

      return this.#commands.isEnabled(id, this.#commandContext(window));
    },
  );

  /**
   * Creates the Electron application service graph.
   *
   * @param nativeDialogs - outer native-choice boundary shared by file and document workflows.
   * @param log - application logger that receives shell lifecycle diagnostics.
   */
  constructor(
    nativeDialogs: NativeDialogs = electronNativeDialogs,
    log: ShiftLogger = createShiftLogger("app"),
  ) {
    this.#log = log;
    this.#nativeDialogs = nativeDialogs;
    this.#aboutWindow = new AboutWindow(
      path.join(__dirname, "preload.js"),
      createShiftLogger("app.about"),
    );
    this.#feedbackWindow = new FeedbackWindow(
      path.join(__dirname, "preload.js"),
      createShiftLogger("app.feedback"),
    );
    this.#workspaces = new WorkspaceManager({
      documentsRoot: () => this.#requireDocumentsRoot(),
      applicationName: () => this.applicationName,
      nativeDialogs: this.#nativeDialogs,
      onSessionCrashed: (session) => this.#handleDocumentCrash(session, null),
    });
    this.#lifecycle = new AppLifecycle({
      documentForWindow: (window) => {
        const session = this.#workspaces.getForBrowserWindow(window.window);
        if (!session?.document || session.windows.size > 1) return null;

        return session.document;
      },
      documents: () =>
        this.#workspaces.list().flatMap((session) => (session.document ? [session.document] : [])),
      log: this.#log,
    });
    this.#updater = new AppUpdater({
      lifecycle: this.#lifecycle,
      activeWindow: () => this.#windows.activeWindow(),
      log: createShiftLogger("app.update"),
    });
  }

  get applicationName(): string {
    return app.name;
  }

  /**
   * Starts Electron and installs the main-process service graph.
   *
   * @remarks
   * Commands and IPC handlers are registered before the window exists so
   * renderer calls can arrive as soon as preload exposes `window.shiftHost`.
   * Command handlers resolve the active window from a fresh context at run time.
   */
  start(): void {
    const applicationName = app.isPackaged ? shiftProductName : `${shiftProductName} Dev`;
    app.setName(applicationName);

    if (!app.commandLine.hasSwitch("user-data-dir")) {
      app.setPath("userData", path.join(app.getPath("appData"), applicationName));
    }

    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on("open-file", (event, sourcePath) => {
      event.preventDefault();
      this.#handleOpenPath(sourcePath);
    });
    app.on("second-instance", (_event, commandLine) => {
      let handledOpenPath = false;
      for (const argument of commandLine) {
        if (path.extname(argument).toLowerCase() !== ".shift") continue;

        handledOpenPath = true;
        this.#handleOpenPath(argument);
      }

      if (!handledOpenPath) this.#windows.activeWindow()?.focus();
    });
    for (const argument of process.argv) this.#handleOpenPath(argument);

    this.#log.info("starting");

    this.#registerCommands();
    this.#registerIpcHandlers();
    this.#lifecycle.start();

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    void app.whenReady().then(async () => {
      this.#log.info("running when ready callback");

      this.#documentsRoot = path.join(app.getPath("userData"), "working-documents");

      const restoredSessions = await this.#workspaces.restoreRecoveries();
      for (const session of restoredSessions) {
        const window = this.#createWindow(false, undefined, true);
        this.#workspaces.attachWindow(session.workspaceId, window);
        this.#loadWorkspace(window);
      }

      this.#appIcon.install();
      this.#applicationMenu.install();
      app.on("browser-window-focus", () => {
        this.#applicationMenu.updateCommandStates();
      });

      switch (process.env.SHIFT_E2E_FONT_PATH) {
        case undefined:
        case "":
          break;
        default:
          try {
            const session = await this.#workspaces.openPath(process.env.SHIFT_E2E_FONT_PATH);
            const window = this.#createWindow(false);
            this.#workspaces.attachWindow(session.workspaceId, window);
            this.#loadWorkspace(window);
          } catch (error) {
            this.#log.error("failed to open E2E workspace", error);
          }
          break;
      }

      await this.#openExternalPath();
      if (this.#windows.allWindows().length === 0) this.#openLauncher();

      app.on("activate", () => {
        if (this.#windows.allWindows().length === 0) this.#openLauncher();
      });

      this.#updater.start();
      this.#log.info("finished when ready callback");
    });
    app.on("will-quit", () => {
      this.#log.info("will quit: disposing app services");
      for (const session of this.#workspaces.list()) {
        this.#workspaces.unregister(session.workspaceId);
      }
    });
  }

  #createWindow(autoShow = true, bounds?: Rectangle, maximised = false, minWidth?: number): Window {
    const window = new Window({
      preloadPath: path.join(__dirname, "preload.js"),
      autoShow,
      maximised,
      ...(minWidth === undefined ? {} : { minWidth }),
      ...(bounds
        ? {
            width: bounds.width,
            height: bounds.height,
            browserWindowOptions: { x: bounds.x, y: bounds.y },
          }
        : {}),
    });
    this.#windows.add(window);
    window.window.webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;

      const session = this.#workspaces.getForBrowserWindow(window.window);
      if (!session?.document) return;

      this.#handleDocumentCrash(session, window);
    });

    this.#lifecycle.registerWindow(window, {
      onClosed: () => {
        this.#log.info("working window closed");
        const session = this.#workspaces.getForBrowserWindow(window.window);
        this.#workspaces.detachWindow(window);
        if (session?.windows.size === 0) {
          this.#workspaces.unregister(session.workspaceId);
        }
        this.#windows.remove(window);
        this.#applicationMenu.updateCommandStates();
      },
    });

    return window;
  }

  #openLauncher(): Window {
    const window = this.#createWindow(true, undefined, false, LAUNCHER_MIN_WIDTH);
    this.#loadLauncher(window);
    return window;
  }

  #loadLauncher(window: Window): void {
    this.#loadRenderer(window, "/launcher");
  }

  #handleDocumentCrash(session: FontSessionHost, failedWindow: Window | null): void {
    const existing = this.#documentCrashDecisions.get(session.workspaceId);
    if (existing) return;

    const handling = this.#documentCrashFlow(session.workspaceId, failedWindow);
    this.#documentCrashDecisions.set(session.workspaceId, handling);
    void handling
      .catch((error) => {
        this.#log.error("document crash flow failed", error);
      })
      .finally(() => {
        if (this.#documentCrashDecisions.get(session.workspaceId) === handling) {
          this.#documentCrashDecisions.delete(session.workspaceId);
        }
      });
  }

  async #documentCrashFlow(sessionId: string, failedWindow: Window | null): Promise<void> {
    let failure: "crashed" | "restoreFailed" = "crashed";

    while (true) {
      const session = this.#workspaces.get(sessionId);
      const owner = failedWindow ?? session?.activeWindow() ?? null;
      const choice = await this.#nativeDialogs.confirmDocumentReopen(
        owner,
        this.applicationName,
        failure,
      );
      if (choice === "close") {
        for (const window of this.#crashedWindows(session, failedWindow)) {
          if (!window.window.isDestroyed()) window.window.destroy();
        }
        return;
      }

      try {
        await this.#reopenDocumentWindow(owner, this.#crashedWindows(session, failedWindow));
        return;
      } catch (error) {
        this.#log.error("failed to reopen crashed document", error);
        failure = "restoreFailed";
      }
    }
  }

  async #reopenDocumentWindow(
    owner: Window | null,
    staleWindows?: readonly Window[],
  ): Promise<void> {
    if (!owner) throw new Error("document reopen requires a document window");

    staleWindows ??= [owner];
    const session = this.#workspaces.getForBrowserWindow(owner.window);
    if (!session?.document) throw new Error("document reopen requires an authored workspace");

    const reopened = await this.#workspaces.reopenSession(session.workspaceId);
    const bounds = owner.window.isDestroyed() ? undefined : owner.window.getBounds();
    const window = this.#createWindow(false, bounds);
    this.#workspaces.attachWindow(reopened.workspaceId, window);
    this.#loadWorkspace(window);

    for (const staleWindow of staleWindows) {
      if (!staleWindow.window.isDestroyed()) staleWindow.window.destroy();
    }
  }

  #crashedWindows(session: FontSessionHost | null, failedWindow: Window | null): Window[] {
    if (failedWindow) return [failedWindow];
    return session?.allWindows() ?? [];
  }

  #loadWorkspace(window: Window): void {
    this.#loadRenderer(window, "/home");
  }

  #loadRenderer(window: Window, hash: string): void {
    const source = getRendererSource();
    if (source.type === "url") {
      // in dev load the renderer from vite at MAIN_WINDOW_VITE_DEV_SERVER_URL
      const url = new URL(source.source);
      if (SLUG_ATLAS_PROFILING_ENABLED) url.searchParams.set("shiftProfileSlugAtlas", "1");
      url.hash = hash;
      this.#log.info("loading dev server url", { url: url.toString() });
      window.window.loadURL(url.toString());
      return;
    }

    // otherwise this is the build, load the built file directly
    this.#log.info("loading build file at", { path: source.source });
    window.window.loadFile(source.source, {
      hash,
      ...(SLUG_ATLAS_PROFILING_ENABLED ? { query: { shiftProfileSlugAtlas: "1" } } : {}),
    });
  }

  #registerCommands(): void {
    registerCommands(this.#commands);
  }

  #registerIpcHandlers(): void {
    ipc.handle(ipcMain, "commands.run", async (event, id) => {
      const window = this.#requireWindowForWebContents(event.sender);
      try {
        await this.#commands.run(id, this.#commandContext(window));
      } finally {
        this.#applicationMenu.updateCommandStates();
      }
    });
    ipc.handle(ipcMain, "menu.showCanvasContextMenu", (event) => {
      const window = this.#requireWindowForWebContents(event.sender);
      if (!this.#commandContext(window).document.hasWorkspace()) return;

      this.#applicationMenu.showCanvasContextMenu(window.window);
    });
    ipc.handle(ipcMain, "clipboard.readText", () => {
      return clipboard.readText();
    });
    ipc.handle(ipcMain, "clipboard.writeText", (_event, text) => {
      clipboard.writeText(text);
    });
    ipc.handle(ipcMain, "update.startDownload", async () => {
      await this.#updater.startDownload();
    });
    ipc.handle(ipcMain, "update.cancelDownload", () => {
      this.#updater.cancelDownload();
    });
    ipc.handle(ipcMain, "update.restartToUpdate", async () => {
      await this.#updater.restartToUpdate();
    });
    ipc.handle(ipcMain, "update.later", () => {
      this.#updater.later();
    });
    ipc.handle(ipcMain, "document.connect", (event) => {
      this.#log.info("document connect requested");
      const session = this.#fontSessionForSender(event.sender, "document.connect");
      if (!session.documentClient) throw new Error("document.connect requires an authored font");
      const { port1, port2 } = new MessageChannelMain();

      session.documentClient.connect(port1);
      event.sender.postMessage("document.port", null, [port2]);
      this.#log.info("document port sent to renderer");
    });
    ipc.handle(ipcMain, "session.mode", (event) => {
      return this.#fontSessionForSender(event.sender, "session.mode").mode;
    });
    ipc.handle(ipcMain, "session.connect", async (event) => {
      this.#log.info("font session connect requested");
      const session = this.#fontSessionForSender(event.sender, "session.connect");
      const { port1, port2 } = new MessageChannelMain();

      try {
        await session.workspaceProcess.whenReady();
        await session.workspaceProcess.connectSyncLane(port1);
      } catch (error) {
        this.#log.error("font session connect failed", error);
        port1.close();
        port2.close();
        throw error;
      }

      event.sender.postMessage("session.port", null, [port2]);
      this.#log.info("font session port sent to renderer");
    });
    ipc.handle(ipcMain, "window.reopenDocument", async (event) => {
      const window = this.#requireWindowForWebContents(event.sender);
      await this.#reopenDocumentWindow(window);
    });
    ipc.handle(ipcMain, "errors.reportRenderer", (_event, report) => {
      this.#log.warn("renderer error reported", report);
    });
    ipc.handle(ipcMain, "session.ready", (event) => {
      if (SLUG_ATLAS_PROFILING_ENABLED) {
        this.#log.info("[slug-atlas-profile]", {
          boundary: "main",
          phase: "workspace-ready-requested",
        });
      }
      const session = this.#fontSessionForSender(event.sender, "session.ready");
      const window = this.#requireWindowForWebContents(event.sender);
      const browserWindow = window.window;
      this.#log.info("font session ready", {
        mode: session.mode,
        windowId: browserWindow.id,
      });
      session.document?.refreshWindowTitles();
      this.#applicationMenu.updateCommandStates();
      if (browserWindow.isVisible() || browserWindow.isMinimized()) return;

      window.present();
    });
  }

  #commandContext(window?: Window): CommandContext {
    window ??= this.#windows.activeWindow() ?? undefined;
    const session = window ? this.#workspaces.getForBrowserWindow(window.window) : null;
    const document = session?.document ?? null;

    return {
      update: {
        checkForUpdates: async () => {
          await this.#updater.checkForUpdates("manual");
        },
      },
      document: {
        create: async () => {
          if (!window) return;

          await this.#createWorkspaceFromWindow(window);
        },
        open: async () => {
          if (!window) return;

          await this.#openWorkspaceFromWindow(window);
        },
        canSave: () =>
          document !== null ||
          (session?.mode === "preview" &&
            session.sourcePath !== null &&
            isConvertiblePreviewPath(session.sourcePath)),
        hasWorkspace: () => document !== null,
        save: async () => {
          if (document) {
            await document.save();
          } else if (window && session?.mode === "preview") {
            await this.#savePreviewAsDocument(window, session);
          }
        },
        saveAs: async () => {
          if (document) {
            await document.saveAs();
          } else if (window && session?.mode === "preview") {
            await this.#savePreviewAsDocument(window, session);
          }
        },
        exportTtf: async () => {
          await document?.exportTtf();
        },
      },
      windows: {
        active: () => window ?? null,
        showAbout: () => {
          this.#aboutWindow.show();
        },
        showFeedback: () => {
          this.#feedbackWindow.show();
        },
        showHome: () => {
          const home = this.#windows
            .allWindows()
            .find((candidate) => this.#workspaces.getForBrowserWindow(candidate.window) === null);
          if (home) {
            home.focus();
            return;
          }

          this.#openLauncher();
        },
      },
      renderer: {
        available: () => session !== null,
        run: (id) => {
          if (!window || !session) return;

          window.runRendererCommand(id);
        },
      },
    };
  }

  async #savePreviewAsDocument(window: Window, preview: FontSessionHost): Promise<void> {
    const existing = this.#previewConversions.get(preview.sessionId);
    if (existing) return existing;

    const converting = (async () => {
      try {
        const sourcePath = preview.sourcePath;
        if (!sourcePath || !isConvertiblePreviewPath(sourcePath)) return;

        const parsedSourcePath = path.parse(sourcePath);
        const suggestedPath = path.join(parsedSourcePath.dir, `${parsedSourcePath.name}.shift`);
        const documentPath = await this.#nativeDialogs.saveShiftDocument(window, suggestedPath);
        if (!documentPath) return;

        const authored = await this.#workspaces.createDocumentFromPreview(sourcePath, documentPath);
        if (this.#workspaces.getForBrowserWindow(window.window) !== preview) {
          this.#workspaces.unregister(authored.workspaceId);
          return;
        }

        this.#workspaces.detachWindow(window);
        try {
          this.#workspaces.attachWindow(authored.workspaceId, window);
        } catch (error) {
          this.#workspaces.attachWindow(preview.workspaceId, window);
          this.#workspaces.unregister(authored.workspaceId);
          throw error;
        }

        if (preview.windows.size === 0) this.#workspaces.unregister(preview.workspaceId);
        this.#applicationMenu.updateCommandStates();
        window.window.webContents.reload();
      } catch (error) {
        this.#log.warn("preview save failed", error);
        await this.#nativeDialogs.showSaveFailure(window, this.applicationName);
      }
    })();

    this.#previewConversions.set(preview.sessionId, converting);
    try {
      await converting;
    } finally {
      if (this.#previewConversions.get(preview.sessionId) === converting) {
        this.#previewConversions.delete(preview.sessionId);
      }
    }
  }

  #handleOpenPath(sourcePath: string): void {
    if (path.extname(sourcePath).toLowerCase() !== ".shift") return;

    const openPath = path.resolve(sourcePath);
    if (this.#pendingOpenPaths.includes(openPath)) return;

    const shouldStartOpening = this.#pendingOpenPaths.length === 0;
    this.#pendingOpenPaths.push(openPath);
    if (!this.#documentsRoot || !shouldStartOpening) return;

    void this.#openExternalPath().catch((error) => {
      this.#log.error("failed to process external document paths", error);
    });
  }

  async #openExternalPath(): Promise<void> {
    while (this.#pendingOpenPaths.length > 0) {
      const sourcePath = this.#pendingOpenPaths[0];

      try {
        const session = await this.#workspaces.openPath(sourcePath);
        const opener = this.#windows.activeWindow();
        if (opener) {
          if (this.#focusExistingWorkspaceWindow(opener, session)) continue;

          this.#openWorkspaceWindow(opener, session);
          continue;
        }

        const window = this.#createWindow(false, undefined, true);
        this.#workspaces.attachWindow(session.workspaceId, window);
        this.#loadWorkspace(window);
      } catch (error) {
        this.#log.error("failed to open external document", sourcePath, error);
      } finally {
        this.#pendingOpenPaths.shift();
      }
    }
  }

  async #createWorkspaceFromWindow(opener: Window): Promise<void> {
    try {
      const session = await this.#workspaces.createUntitled();
      this.#openWorkspaceWindow(opener, session);
    } catch (error) {
      this.#log.warn("new document failed", error);
      await this.#nativeDialogs.showCreateFailure(opener, this.applicationName);
    }
  }

  async #openWorkspaceFromWindow(opener: Window): Promise<void> {
    try {
      const openPath = await this.#nativeDialogs.openFont(opener);
      if (!openPath) return;

      const session = await this.#workspaces.openPath(openPath);
      if (this.#focusExistingWorkspaceWindow(opener, session)) return;

      this.#openWorkspaceWindow(opener, session);
    } catch (error) {
      this.#log.warn("open document failed", error);
      await this.#nativeDialogs.showOpenFailure(opener, this.applicationName);
    }
  }

  #focusExistingWorkspaceWindow(opener: Window, session: FontSessionHost): boolean {
    const existingWindow = session.activeWindow();
    if (!existingWindow) return false;

    existingWindow.focus();
    if (this.#workspaces.getForBrowserWindow(opener.window) === null) opener.close();
    return true;
  }

  #openWorkspaceWindow(opener: Window, session: FontSessionHost): void {
    const closeOpener = this.#workspaces.getForBrowserWindow(opener.window) === null;

    const bounds = screen.getDisplayMatching(opener.window.getBounds()).workArea;
    const workspaceWindow = this.#createWindow(false, bounds);

    this.#workspaces.attachWindow(session.workspaceId, workspaceWindow);
    this.#loadWorkspace(workspaceWindow);

    if (closeOpener) opener.close();
  }

  #fontSessionForSender(sender: WebContents, operation: string): FontSessionHost {
    const window = this.#requireWindowForWebContents(sender);
    const session = this.#workspaces.getForBrowserWindow(window.window);
    if (!session) {
      throw new Error(`${operation} requires a workspace-bound window`);
    }

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
