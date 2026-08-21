import { app, Menu, type MenuItemConstructorOptions } from "electron";
import type { CommandId } from "../../shared/commands";
import { commandMenuItem, fileMenuItems } from "./menuItems";
import { commands } from "../commands/Commands";
import { shiftProductVersion } from "../release";

const isMac = process.platform === "darwin";

/**
 * Builds and installs the native application menu.
 *
 * @remarks
 * Native OS roles belong here directly. Shift-specific behavior should route
 * through the command registry so menus, shortcuts, and renderer chrome share
 * the same command implementation.
 */
export class ApplicationMenu {
  readonly #aboutIconPath: string;
  readonly #runCommand: (id: CommandId) => void;
  readonly #isCommandEnabled: (id: CommandId) => boolean;
  #menu: Menu | null = null;

  constructor(
    aboutIconPath: string,
    runCommand: (id: CommandId) => void,
    isCommandEnabled: (id: CommandId) => boolean,
  ) {
    this.#aboutIconPath = aboutIconPath;
    this.#runCommand = runCommand;
    this.#isCommandEnabled = isCommandEnabled;
  }

  /** Installs the current menu template as Electron's application menu. */
  install(): void {
    this.configureAboutPanel();
    this.#menu = this.build();
    Menu.setApplicationMenu(this.#menu);
  }

  /** Re-evaluates command capabilities against the active window and session. */
  updateCommandStates(): void {
    if (!this.#menu) return;

    for (const command of commands) {
      const item = this.#menu.getMenuItemById(command.id);
      if (item) item.enabled = this.#isCommandEnabled(command.id);
    }
  }

  /** Configures the native About panel opened by Electron's `about` role. */
  configureAboutPanel(): void {
    app.setAboutPanelOptions({
      applicationName: app.name,
      applicationVersion: shiftProductVersion,
      version: shiftProductVersion,
      copyright: "Copyright © 2026 Shift",
      credits: "A font editor for drawing, spacing, and shaping type.",
      iconPath: this.#aboutIconPath,
    });
  }

  /**
   * Builds a fresh Electron menu from the current app state.
   *
   * @returns a new menu instance ready to install.
   */
  build(): Menu {
    return Menu.buildFromTemplate(this.template());
  }

  /** Builds the platform-appropriate top-level menu template. */
  template(): MenuItemConstructorOptions[] {
    return isMac ? this.buildMacMenu() : this.buildWindowsMenu();
  }

  /** Builds the macOS app menu. */
  buildMacMenu(): MenuItemConstructorOptions[] {
    return [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          this.#commandItem("app.checkForUpdates"),
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: this.#fileItems(),
      },
      {
        label: "Edit",
        submenu: this.#editItems(),
      },
      {
        label: "View",
        submenu: [
          ...this.#viewZoomItems(),
          { type: "separator" },
          { label: "Developer", submenu: this.#developerItems() },
        ],
      },
      {
        label: "Glyph",
        submenu: this.#glyphItems(),
      },
    ];
  }

  /** Builds the Windows/Linux app menu. */
  buildWindowsMenu(): MenuItemConstructorOptions[] {
    return [
      {
        label: "File",
        submenu: this.#fileItems(),
      },
      {
        label: "Edit",
        submenu: this.#editItems(),
      },
      {
        label: "View",
        submenu: this.#viewZoomItems(),
      },
      {
        label: "Glyph",
        submenu: this.#glyphItems(),
      },
      {
        label: "Help",
        submenu: [
          this.#commandItem("app.checkForUpdates"),
          { type: "separator" },
          { role: "about" },
        ],
      },
    ];
  }

  #viewZoomItems(): MenuItemConstructorOptions[] {
    return [
      this.#commandItem("ui.zoomIn"),
      this.#commandItem("ui.zoomOut"),
      this.#commandItem("ui.zoomReset"),
    ];
  }

  #developerItems(): MenuItemConstructorOptions[] {
    const tools: MenuItemConstructorOptions[] = [{ role: "toggleDevTools" }];
    if (app.isPackaged) return tools;

    return [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, ...tools];
  }

  #fileItems(): MenuItemConstructorOptions[] {
    return fileMenuItems(this.#runCommand, this.#isCommandEnabled);
  }

  #editItems(): MenuItemConstructorOptions[] {
    return [
      this.#commandItem("edit.undo"),
      this.#commandItem("edit.redo"),
      { type: "separator" },
      this.#commandItem("edit.cut"),
      this.#commandItem("edit.copy"),
      this.#commandItem("edit.paste"),
      this.#commandItem("edit.deleteSelection"),
      { type: "separator" },
      this.#commandItem("edit.selectAll"),
    ];
  }

  #glyphItems(): MenuItemConstructorOptions[] {
    return [this.#commandItem("glyph.reverseSelectedContour")];
  }

  /** Builds a menu item from the command registry's metadata. */
  #commandItem(id: CommandId): MenuItemConstructorOptions {
    return commandMenuItem(id, this.#runCommand, this.#isCommandEnabled);
  }
}
