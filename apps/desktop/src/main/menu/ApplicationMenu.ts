import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { CommandId } from "../../shared/commands";
import { commandMenuItem, fileMenuItems } from "./menuItems";
import { commands } from "../commands/Commands";

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
  readonly #runCommand: (id: CommandId, window?: BrowserWindow) => void;
  readonly #isCommandEnabled: (id: CommandId, window?: BrowserWindow) => boolean;
  #menu: Menu | null = null;

  /**
   * Creates the platform menu builder.
   *
   * @param runCommand - executes Shift-owned menu actions against the current window.
   * @param isCommandEnabled - resolves each command's current native enabled state.
   */
  constructor(
    runCommand: (id: CommandId, window?: BrowserWindow) => void,
    isCommandEnabled: (id: CommandId, window?: BrowserWindow) => boolean,
  ) {
    this.#runCommand = runCommand;
    this.#isCommandEnabled = isCommandEnabled;
  }

  /** Installs the current menu template as Electron's application menu. */
  install(): void {
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

  /**
   * Builds a fresh Electron menu from the current app state.
   *
   * @returns a new menu instance ready to install.
   */
  build(): Menu {
    return Menu.buildFromTemplate(this.template());
  }

  /** Opens the native editing menu for the glyph canvas under the current pointer. */
  showCanvasContextMenu(window: BrowserWindow): void {
    const menu = Menu.buildFromTemplate([
      this.#commandItem("edit.cut", window),
      this.#commandItem("edit.copy", window),
      this.#commandItem("edit.paste", window),
      { type: "separator" },
      this.#commandItem("edit.duplicate", window),
      this.#commandItem("edit.deleteSelection", window),
      { type: "separator" },
      this.#commandItem("edit.selectAll", window),
      this.#commandItem("edit.deselect", window),
      { type: "separator" },
      this.#commandItem("glyph.reverseSelectedContour", window),
    ]);

    menu.popup({ window });
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
          this.#commandItem("app.showAbout"),
          this.#commandItem("app.checkForUpdates"),
          { type: "separator" },
          this.#commandItem("app.showSettings"),
          { type: "separator" },
          { role: "services", submenu: [] },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: this.#fileItems(false),
      },
      {
        label: "Edit",
        submenu: this.#editItems(false),
      },
      {
        label: "View",
        submenu: this.#viewItems(true),
      },
      {
        label: "Glyph",
        submenu: this.#glyphItems(),
      },
      {
        role: "windowMenu",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          this.#commandItem("window.showHome"),
        ],
      },
      {
        role: "help",
        submenu: this.#helpItems(false),
      },
    ];
  }

  /** Builds the Windows/Linux app menu. */
  buildWindowsMenu(): MenuItemConstructorOptions[] {
    return [
      {
        label: "File",
        submenu: this.#fileItems(true),
      },
      {
        label: "Edit",
        submenu: this.#editItems(true),
      },
      {
        label: "View",
        submenu: this.#viewItems(false),
      },
      {
        label: "Glyph",
        submenu: this.#glyphItems(),
      },
      {
        role: "help",
        submenu: this.#helpItems(true),
      },
    ];
  }

  #viewItems(includeDeveloper: boolean): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      this.#commandItem("view.zoomIn"),
      this.#commandItem("view.zoomOut"),
      { type: "separator" },
      {
        label: "Interface Size",
        submenu: [
          this.#commandItem("ui.increaseSize", undefined, "Increase"),
          this.#commandItem("ui.decreaseSize", undefined, "Decrease"),
          this.#commandItem("ui.resetSize", undefined, "Reset"),
        ],
      },
    ];
    if (app.isPackaged || !includeDeveloper) return items;

    return [
      ...items,
      { type: "separator" },
      { label: "Developer", submenu: this.#developerItems() },
    ];
  }

  #developerItems(): MenuItemConstructorOptions[] {
    return [
      { role: "reload" },
      { role: "forceReload" },
      { type: "separator" },
      { role: "toggleDevTools" },
    ];
  }

  #fileItems(includeQuit: boolean): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      ...fileMenuItems(this.#runCommand, this.#isCommandEnabled),
      { type: "separator" },
      this.#commandItem("window.close"),
    ];
    if (!includeQuit) return items;

    return [...items, { type: "separator" }, { role: "quit" }];
  }

  #editItems(includeSettings: boolean): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
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
    if (!includeSettings) return items;

    return [...items, { type: "separator" }, this.#commandItem("app.showSettings")];
  }

  #helpItems(includeApplicationItems: boolean): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      this.#commandItem("help.openDiscord"),
      this.#commandItem("help.openX"),
      { type: "separator" },
      this.#commandItem("help.reportIssue"),
    ];
    if (!includeApplicationItems) return items;

    return [
      ...items,
      { type: "separator" },
      this.#commandItem("app.checkForUpdates"),
      { type: "separator" },
      this.#commandItem("app.showAbout"),
    ];
  }

  #glyphItems(): MenuItemConstructorOptions[] {
    return [this.#commandItem("glyph.reverseSelectedContour")];
  }

  /** Builds a menu item from the command registry's metadata. */
  #commandItem(id: CommandId, window?: BrowserWindow, label?: string): MenuItemConstructorOptions {
    const item = commandMenuItem(
      id,
      (commandId) => this.#runCommand(commandId, window),
      (commandId) => this.#isCommandEnabled(commandId, window),
    );

    return label ? { ...item, label } : item;
  }
}
