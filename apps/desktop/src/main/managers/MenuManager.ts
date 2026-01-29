import { Menu, dialog, nativeTheme } from "electron";
import type { DocumentState } from "./DocumentState";
import type { WindowManager } from "./WindowManager";

export type Theme = "light" | "dark" | "system";

export class MenuManager {
  private documentState: DocumentState;
  private windowManager: WindowManager;
  private currentTheme: Theme = "light";

  constructor(documentState: DocumentState, windowManager: WindowManager) {
    this.documentState = documentState;
    this.windowManager = windowManager;
  }

  getTheme(): Theme {
    return this.currentTheme;
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

  setTheme(theme: Theme) {
    this.currentTheme = theme;
    const window = this.windowManager.getWindow();
    window?.webContents.send("theme:set", theme);

    if (theme === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = theme;
    }

    this.create();
  }

  create() {
    const isMac = process.platform === "darwin";
    const window = this.windowManager.getWindow();

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
                properties: ["openFile"],
                filters: [{ name: "Fonts", extensions: ["ttf", "otf", "ufo"] }],
              });
              if (!result.canceled && result.filePaths[0]) {
                this.documentState.setFilePath(result.filePaths[0]);
                window?.webContents.send("menu:open-font", result.filePaths[0]);
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
            click: () => window?.webContents.send("menu:undo"),
          },
          {
            label: "Redo",
            accelerator: "CmdOrCtrl+Shift+Z",
            click: () => window?.webContents.send("menu:redo"),
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          {
            label: "Delete",
            accelerator: "Backspace",
            click: () => window?.webContents.send("menu:delete"),
          },
          { type: "separator" },
          {
            label: "Select All",
            accelerator: "CmdOrCtrl+A",
            click: () => window?.webContents.send("menu:select-all"),
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
                win.webContents.send("ui:zoom-changed", newPercent);
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
                win.webContents.send("ui:zoom-changed", newPercent);
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
                win.webContents.send("ui:zoom-changed", 100);
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
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}
