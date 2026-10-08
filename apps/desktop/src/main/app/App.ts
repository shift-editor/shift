import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  MessageChannelMain,
  screen,
  shell,
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
import { FONT_FOLDER_EXTENSIONS, OPEN_FONT_EXTENSIONS } from "../../shared/openFontExtensions";
import { RecentDocuments } from "../recents/RecentDocuments";
import type { RecentDocumentVisit } from "../../shared/recents";

const SLUG_ATLAS_PROFILING_ENABLED =
  process.env.SHIFT_PROFILE_SLUG_ATLAS !== undefined &&
  process.env.SHIFT_PROFILE_SLUG_ATLAS !== "0";
/** Loads a reopened document on Home and has the renderer return it to its last glyph. */
const RESUME_ROUTE = "/home?resume";
const LAUNCHER_MIN_WIDTH = 880;
const LAUNCHER_WIDTH = 960;
const LAUNCHER_HEIGHT = 720;
/** Largest share of the screen the launcher takes on displays smaller than its size. */
const LAUNCHER_MAX_SCREEN_SHARE = 0.9;
const LAUNCHER_SHOW_FALLBACK_MS = 2000;

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
  #recents: RecentDocuments | null = null;
  /** The recents entry each document session was last recorded under. */
  #documentVisits = new WeakMap<FontSessionHost, RecentDocumentVisit>();
  /** Launchers a font open is replacing; they stop receiving recents so no half-ready card flashes. */
  #replacedLaunchers = new WeakSet<Window>();
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
    () => ({
      documents: this.#recents?.list() ?? [],
      open: (sourcePath) => this.#openRecentFromMenu(sourcePath),
      clear: () => this.#recents?.clear(),
    }),
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
      onDocumentVisited: (visit, session) => {
        const previous = this.#documentVisits.get(session);
        if (previous && previous.path !== visit.path) this.#recents?.setOpen(previous, false);
        this.#documentVisits.set(session, visit);
        this.#recents?.record(visit);
        this.#recents?.setOpen(visit, true);
        if (this.#recents?.needsSpecimen(visit)) void this.#buildSpecimen(visit, session);
      },
      onDocumentSaved: (visit, session) => void this.#buildSpecimen(visit, session),
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
        if (!OPEN_FONT_EXTENSIONS.includes(path.extname(argument).slice(1).toLowerCase())) continue;

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
      this.#recents = new RecentDocuments(
        path.join(app.getPath("userData"), "recent-documents.json"),
      );
      this.#recents.onChanged(() => this.#publishRecents());

      // Taken before recovery, which marks the documents it restores open again.
      const openAtLastExit = this.#recents.takeOpen();
      const restoredSessions = await this.#workspaces.restoreRecoveries();
      for (const session of restoredSessions) this.#showResumedWorkspace(session);
      await this.#reopenDocuments(openAtLastExit);

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
            // A document Shift reopened on launch already has its window.
            if (session.windows.size === 0) {
              const window = this.#createWindow(false);
              this.#workspaces.attachWindow(session.workspaceId, window);
              this.#loadWorkspace(window);
            }
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
      // Only an ordinary quit forgets open documents; an update restart reopens them.
      if (this.#lifecycle.quitReason === "quit") this.#recents?.clearOpen();
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
        if (session?.windows.size === 0) this.#endSession(session);
        this.#windows.remove(window);
        this.#applicationMenu.updateCommandStates();
      },
    });

    return window;
  }

  /**
   * Creates the launcher hidden and shows it once its recent files have rendered.
   *
   * @remarks
   * The renderer signals `window.ready`; the timer shows the window anyway if
   * that signal never arrives, so a renderer failure cannot leave it invisible.
   */
  #openLauncher(): Window {
    const window = this.#createWindow(false, launcherBounds(), false, LAUNCHER_MIN_WIDTH);
    this.#loadLauncher(window);
    setTimeout(() => this.#presentIfHidden(window), LAUNCHER_SHOW_FALLBACK_MS);
    return window;
  }

  #presentIfHidden(window: Window): void {
    const browserWindow = window.window;
    if (browserWindow.isDestroyed() || browserWindow.isVisible()) return;

    window.present();
  }

  #loadLauncher(window: Window): void {
    this.#loadRenderer(window, "/launcher");
  }

  #handleDocumentCrash(session: FontSessionHost, failedWindow: Window | null): void {
    if (this.#lifecycle.terminating) return;

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

    while (!this.#lifecycle.terminating) {
      const session = this.#workspaces.get(sessionId);
      const owner = failedWindow ?? session?.activeWindow() ?? null;
      const choice = await this.#nativeDialogs.confirmDocumentReopen(
        owner,
        this.applicationName,
        failure,
      );
      if (this.#lifecycle.terminating) return;

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
    this.#loadWorkspace(window, RESUME_ROUTE);

    for (const staleWindow of staleWindows) {
      if (!staleWindow.window.isDestroyed()) staleWindow.window.destroy();
    }
  }

  #crashedWindows(session: FontSessionHost | null, failedWindow: Window | null): Window[] {
    if (failedWindow) return [failedWindow];
    return session?.allWindows() ?? [];
  }

  #loadWorkspace(window: Window, route: string = "/home"): void {
    this.#loadRenderer(window, route);
  }

  /** Shows a workspace reopened after an interruption, asking the renderer to resume its view. */
  #showResumedWorkspace(session: FontSessionHost): void {
    const window = this.#createWindow(false, undefined, true);
    this.#workspaces.attachWindow(session.workspaceId, window);
    this.#loadWorkspace(window, RESUME_ROUTE);
  }

  /** Ends a session whose last window closed; while quitting, its document stays marked open. */
  #endSession(session: FontSessionHost): void {
    this.#workspaces.unregister(session.workspaceId);
    if (this.#lifecycle.quitReason !== null || this.#lifecycle.terminating) return;

    const visit = this.#documentVisits.get(session);
    if (visit) this.#recents?.setOpen(visit, false);
  }

  /** Reopens documents that were open when Shift last stopped without a normal quit. */
  async #reopenDocuments(visits: readonly RecentDocumentVisit[]): Promise<void> {
    for (const visit of visits) {
      try {
        const session = await this.#workspaces.openPath(visit.path);
        // Recovery may already have restored this document.
        if (session.windows.size === 0) this.#showResumedWorkspace(session);
      } catch (error) {
        this.#log.warn("failed to reopen document", { path: visit.path, error });
      }
    }
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
    ipc.handle(ipcMain, "recents.list", () => {
      return this.#recents?.list() ?? [];
    });
    ipc.handle(ipcMain, "recents.open", async (event, sourcePath) => {
      const window = this.#requireWindowForWebContents(event.sender);
      await this.#openPathFromWindow(window, sourcePath);
    });
    ipc.handle(ipcMain, "recents.remove", (_event, sourcePath) => {
      return this.#recents?.remove(sourcePath) ?? null;
    });
    ipc.handle(ipcMain, "recents.restore", (_event, document) => {
      this.#recents?.restore(document);
    });
    ipc.handle(ipcMain, "recents.reveal", (_event, sourcePath) => {
      shell.showItemInFolder(sourcePath);
    });
    ipc.handle(ipcMain, "recents.locate", async (event, missingPath) => {
      const window = this.#requireWindowForWebContents(event.sender);
      const locatedPath = isFontFolderPath(missingPath)
        ? await this.#nativeDialogs.openFontFolder(window)
        : await this.#nativeDialogs.openFont(window);
      if (!locatedPath) return;

      const opened = await this.#openPathFromWindow(window, locatedPath);
      if (opened && path.resolve(locatedPath) !== missingPath) this.#recents?.remove(missingPath);
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
    ipc.handle(ipcMain, "window.ready", (event) => {
      this.#presentIfHidden(this.#requireWindowForWebContents(event.sender));
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
          await this.#createWorkspaceFromWindow(window ?? null);
        },
        open: async () => {
          await this.#openWorkspaceFromWindow(window ?? null, (opener) =>
            this.#nativeDialogs.openFont(opener),
          );
        },
        openFolder: async () => {
          await this.#openWorkspaceFromWindow(window ?? null, (opener) =>
            this.#nativeDialogs.openFontFolder(opener),
          );
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
          this.#endSession(authored);
          return;
        }

        this.#workspaces.detachWindow(window);
        try {
          this.#workspaces.attachWindow(authored.workspaceId, window);
        } catch (error) {
          this.#workspaces.attachWindow(preview.workspaceId, window);
          this.#endSession(authored);
          throw error;
        }

        if (preview.windows.size === 0) this.#endSession(preview);
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
    if (!OPEN_FONT_EXTENSIONS.includes(path.extname(sourcePath).slice(1).toLowerCase())) return;

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
        const opener =
          this.#windows.activeWindow() ??
          this.#windows
            .allWindows()
            .find((window) => this.#workspaces.getForBrowserWindow(window.window) === null);
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

  async #createWorkspaceFromWindow(opener: Window | null): Promise<void> {
    try {
      const session = await this.#workspaces.createUntitled();
      this.#openWorkspaceWindow(opener, session);
    } catch (error) {
      this.#log.warn("new document failed", error);
      await this.#nativeDialogs.showCreateFailure(opener, this.applicationName);
    }
  }

  /**
   * Asks the user for a font and opens it on behalf of a window.
   *
   * @param choosePath - native picker for the kind of font being opened.
   */
  async #openWorkspaceFromWindow(
    opener: Window | null,
    choosePath: (opener: Window | null) => Promise<string | null>,
  ): Promise<void> {
    let openPath: string | null;
    try {
      openPath = await choosePath(opener);
    } catch (error) {
      this.#log.warn("open dialog failed", error);
      await this.#nativeDialogs.showOpenFailure(opener, this.applicationName);
      return;
    }
    if (!openPath) return;

    await this.#openPathFromWindow(opener, openPath);
  }

  /**
   * Opens a font path on behalf of a window, showing a native failure when it cannot open.
   *
   * @returns whether a workspace window now shows the file.
   */
  async #openPathFromWindow(opener: Window | null, sourcePath: string): Promise<boolean> {
    const openerIsLauncher = opener
      ? this.#workspaces.getForBrowserWindow(opener.window) === null
      : false;
    if (openerIsLauncher && opener) this.#replacedLaunchers.add(opener);

    try {
      const session = await this.#workspaces.openPath(sourcePath);
      if (opener && this.#focusExistingWorkspaceWindow(opener, session)) return true;

      this.#openWorkspaceWindow(opener, session);
      return true;
    } catch (error) {
      this.#log.warn("open document failed", error);
      if (openerIsLauncher && opener) this.#restoreLauncherRecents(opener);
      await this.#nativeDialogs.showOpenFailure(opener, this.applicationName);
      return false;
    }
  }

  #restoreLauncherRecents(launcher: Window): void {
    this.#replacedLaunchers.delete(launcher);
    if (launcher.window.isDestroyed()) return;

    ipc.send(launcher.window.webContents, "recents.changed", this.#recents?.list() ?? []);
  }

  #openRecentFromMenu(sourcePath: string): void {
    const opener = this.#windows.activeWindow();
    if (!opener) {
      this.#handleOpenPath(sourcePath);
      return;
    }

    // Menu clicks cannot await; #openPathFromWindow reports its own failures.
    void this.#openPathFromWindow(opener, sourcePath);
  }

  /**
   * Builds a recent file's thumbnail specimen in its session's utility process.
   *
   * @remarks
   * Runs detached from the open or save that triggered it; failures such as
   * the session closing mid-build leave the previous thumbnail in place.
   */
  async #buildSpecimen(visit: RecentDocumentVisit, session: FontSessionHost): Promise<void> {
    try {
      const specimen = await session.workspaceProcess.specimen(visit.path);
      this.#recents?.setSpecimen(visit, specimen);
    } catch (error) {
      this.#log.warn("building recent file specimen failed", visit.path, error);
    }
  }

  #publishRecents(): void {
    this.#applicationMenu.refresh();

    const documents = this.#recents?.list() ?? [];
    for (const window of this.#windows.allWindows()) {
      if (window.window.isDestroyed() || this.#replacedLaunchers.has(window)) continue;
      ipc.send(window.window.webContents, "recents.changed", documents);
    }
  }

  #focusExistingWorkspaceWindow(opener: Window | null, session: FontSessionHost): boolean {
    const existingWindow = session.activeWindow();
    if (!existingWindow) return false;

    existingWindow.focus();
    if (opener && this.#workspaces.getForBrowserWindow(opener.window) === null) {
      this.#closeReplacedLauncher(opener);
    }
    return true;
  }

  #openWorkspaceWindow(opener: Window | null, session: FontSessionHost): void {
    const closeOpener = opener
      ? this.#workspaces.getForBrowserWindow(opener.window) === null
      : false;

    const bounds = opener
      ? screen.getDisplayMatching(opener.window.getBounds()).workArea
      : screen.getPrimaryDisplay().workArea;
    const workspaceWindow = this.#createWindow(false, bounds);

    this.#workspaces.attachWindow(session.workspaceId, workspaceWindow);
    this.#loadWorkspace(workspaceWindow);

    if (closeOpener && opener) this.#closeReplacedLauncher(opener);
  }

  #closeReplacedLauncher(launcher: Window): void {
    this.#replacedLaunchers.add(launcher);
    launcher.close();
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

/** Centres the 4:3 launcher on the primary display, capped to 90% of smaller screens. */
/** Whether a font path is a format stored as a folder, which needs the folder picker. */
function isFontFolderPath(sourcePath: string): boolean {
  return FONT_FOLDER_EXTENSIONS.includes(path.extname(sourcePath).slice(1).toLowerCase());
}

function launcherBounds(): Rectangle {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(LAUNCHER_WIDTH, Math.round(workArea.width * LAUNCHER_MAX_SCREEN_SHARE));
  const height = Math.min(LAUNCHER_HEIGHT, Math.round(workArea.height * LAUNCHER_MAX_SCREEN_SHARE));
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}
