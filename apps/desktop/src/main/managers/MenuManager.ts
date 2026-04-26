import { Menu, dialog, nativeTheme, app } from "electron";
import type { DocumentState } from "./DocumentState";
import type { WindowManager } from "./WindowManager";
import type { ThemeName, DebugOverlays, Debug } from "../../shared/ipc/types";
import type { IpcEvents } from "../../shared/ipc/channels";
import * as ipc from "../../shared/ipc/main";

export class MenuManager {
  private documentState: DocumentState;
  private windowManager: WindowManager;
  private currentTheme: ThemeName = "light";
  private debugState: Debug = {
    reactScanEnabled: false,
    debugPanelOpen: false,
    overlays: {
      tightBounds: false,
      hitRadii: false,
      segmentBounds: false,
      glyphBbox: false,
    },
  };

  constructor(documentState: DocumentState, windowManager: WindowManager) {
    this.documentState = documentState;
    this.windowManager = windowManager;
  }

  getTheme(): ThemeName {
    return this.currentTheme;
  }

  getDebug(): Debug {
    return { ...this.debugState };
  }

  private sendToRenderer<K extends keyof IpcEvents>(
    channel: K,
    ...args: Parameters<IpcEvents[K]>
  ): void {
    const webContents = this.windowManager.getWindow()?.webContents;
    if (!webContents) return;
    ipc.send(webContents, channel, ...args);
  }

  private setDebug<K extends keyof Debug>(key: K, value: Debug[K]) {
    this.debugState[key] = value;
    switch (key) {
      case "reactScanEnabled":
        this.sendToRenderer("debug:react-scan", value as boolean);
        break;
      case "debugPanelOpen":
        this.sendToRenderer("debug:panel", value as boolean);
        break;
      case "overlays":
        this.sendToRenderer("debug:overlays", value as DebugOverlays);
        break;
    }
    this.create();
  }

  private toggleOverlay(key: keyof DebugOverlays): void {
    this.debugState.overlays[key] = !this.debugState.overlays[key];
    this.sendToRenderer("debug:overlays", { ...this.debugState.overlays });
    this.create();
  }

  private static ZOOM_LEVELS = [
    25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
  ];

  private zoomLevelToPercent(zoomLevel: number): number {
    return Math.round(Math.pow(1.2, zoomLevel) * 100);
  }

  private percentToZoomLevel(percent: number): number {
    return Math.log(percent / 100) / Math.log(1.2);
  }

  private getNextZoomPercent(currentPercent: number): number {
    const levels = MenuManager.ZOOM_LEVELS;
    for (const level of levels) {
      if (level > currentPercent + 1) return level;
    }
    return levels[levels.length - 1];
  }

  private getPrevZoomPercent(currentPercent: number): number {
    const levels = MenuManager.ZOOM_LEVELS;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i] < currentPercent - 1) return levels[i];
    }
    return levels[0];
  }

  setTheme(theme: ThemeName) {
    this.currentTheme = theme;
    this.sendToRenderer("theme:set", theme);

    if (theme === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = theme;
    }

    this.create();
  }

  create() {
    const isMac = process.platform === "darwin";

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open Font...",
            accelerator: "CmdOrCtrl+O",
            click: async () => {
              const result = await dialog.showOpenDialog({
                properties: ["openFile", "openDirectory"],
                filters: [
                  {
                    name: "Fonts",
                    extensions: ["ttf", "otf", "ufo", "glyphs", "glyphspackage", "designspace"],
                  },
                ],
              });
              if (!result.canceled && result.filePaths[0]) {
                this.sendToRenderer("menu:open-font", result.filePaths[0]);
              }
            },
          },
          { type: "separator" },
          {
            label: "Save",
            accelerator: "CmdOrCtrl+S",
            click: () => this.documentState.save(false),
          },
          {
            label: "Save As...",
            accelerator: "CmdOrCtrl+Shift+S",
            click: () => this.documentState.save(true),
          },
          { type: "separator" },
          isMac ? { role: "close" } : { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          {
            label: "Undo",
            accelerator: "CmdOrCtrl+Z",
            click: () => {
              this.sendToRenderer("menu:undo");
            },
          },
          {
            label: "Redo",
            accelerator: "CmdOrCtrl+Shift+Z",
            click: () => {
              this.sendToRenderer("menu:redo");
            },
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          {
            label: "Delete",
            accelerator: "Backspace",
            click: () => {
              this.sendToRenderer("menu:delete");
            },
          },
          { type: "separator" },
          {
            label: "Select All",
            click: () => {
              this.sendToRenderer("menu:select-all");
            },
          },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          {
            label: "Zoom In",
            accelerator: "CmdOrCtrl+Plus",
            click: () => {
              const win = this.windowManager.getWindow();
              if (win) {
                const currentPercent = this.zoomLevelToPercent(win.webContents.getZoomLevel());
                const newPercent = this.getNextZoomPercent(currentPercent);
                win.webContents.setZoomLevel(this.percentToZoomLevel(newPercent));
                ipc.send(win.webContents, "ui:zoom-changed", newPercent);
              }
            },
          },
          {
            label: "Zoom Out",
            accelerator: "CmdOrCtrl+Shift+-",
            click: () => {
              const win = this.windowManager.getWindow();
              if (win) {
                const currentPercent = this.zoomLevelToPercent(win.webContents.getZoomLevel());
                const newPercent = this.getPrevZoomPercent(currentPercent);
                win.webContents.setZoomLevel(this.percentToZoomLevel(newPercent));
                ipc.send(win.webContents, "ui:zoom-changed", newPercent);
              }
            },
          },
          {
            label: "Reset Zoom",
            accelerator: "CmdOrCtrl+0",
            click: () => {
              const win = this.windowManager.getWindow();
              if (win) {
                win.webContents.setZoomLevel(0);
                ipc.send(win.webContents, "ui:zoom-changed", 100);
              }
            },
          },
          { type: "separator" },
          {
            label: "Theme",
            submenu: [
              {
                label: "Light",
                type: "radio",
                checked: this.currentTheme === "light",
                click: () => this.setTheme("light"),
              },
              {
                label: "Dark",
                type: "radio",
                checked: this.currentTheme === "dark",
                click: () => this.setTheme("dark"),
              },
              {
                label: "System",
                type: "radio",
                checked: this.currentTheme === "system",
                click: () => this.setTheme("system"),
              },
            ],
          },
        ],
      },
      ...(!app.isPackaged
        ? [
            {
              label: "Debug",
              submenu: [
                {
                  label: "React Scan",
                  type: "checkbox" as const,
                  checked: this.debugState.reactScanEnabled,
                  click: () => this.setDebug("reactScanEnabled", !this.debugState.reactScanEnabled),
                },
                {
                  label: "Debug Panel",
                  type: "checkbox" as const,
                  checked: this.debugState.debugPanelOpen,
                  click: () => this.setDebug("debugPanelOpen", !this.debugState.debugPanelOpen),
                },
                { type: "separator" as const },
                {
                  label: "Dump Glyph Snapshot",
                  accelerator: "CmdOrCtrl+Shift+D",
                  click: () => {
                    this.sendToRenderer("debug:dump-snapshot");
                  },
                },
                {
                  label: "Dump Selection Patterns",
                  accelerator: "CmdOrCtrl+Alt+D",
                  click: () => {
                    this.sendToRenderer("debug:dump-selection-patterns");
                  },
                },
                { type: "separator" as const },
                {
                  label: "Debug Overlays",
                  submenu: [
                    {
                      label: "Tight Bounds on Hover",
                      type: "checkbox" as const,
                      checked: this.debugState.overlays.tightBounds,
                      click: () => this.toggleOverlay("tightBounds"),
                    },
                    {
                      label: "Hit Test Radii",
                      type: "checkbox" as const,
                      checked: this.debugState.overlays.hitRadii,
                      click: () => this.toggleOverlay("hitRadii"),
                    },
                    {
                      label: "Segment Bounding Boxes",
                      type: "checkbox" as const,
                      checked: this.debugState.overlays.segmentBounds,
                      click: () => this.toggleOverlay("segmentBounds"),
                    },
                    {
                      label: "Glyph Bounding Box",
                      type: "checkbox" as const,
                      checked: this.debugState.overlays.glyphBbox,
                      click: () => this.toggleOverlay("glyphBbox"),
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}
