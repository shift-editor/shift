import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { CommandId } from "../../shared/commands";
import type { MenuBar } from "../../shared/menu/types";
import { menuBarFromTemplate, withMenuItemIds } from "./menuBar";
import {
  commandMenuItem,
  editMenuItems,
  fileMenuItems,
  helpMenuItems,
  viewMenuItems,
  type RecentMenu,
} from "./menuItems";
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
  readonly #recent: () => RecentMenu;
  readonly #onMenuBarChanged: () => void;
  #menu: Menu | null = null;
  #template: MenuItemConstructorOptions[] = [];

  /**
   * Creates the platform menu builder.
   *
   * @param runCommand - executes Shift-owned menu actions against the current window.
   * @param isCommandEnabled - resolves each command's current native enabled state.
   * @param recent - resolves File → Open Recent's current files and actions.
   * @param onMenuBarChanged - called on Windows and Linux whenever {@link menuBar} would change.
   */
  constructor(
    runCommand: (id: CommandId, window?: BrowserWindow) => void,
    isCommandEnabled: (id: CommandId, window?: BrowserWindow) => boolean,
    recent: () => RecentMenu,
    onMenuBarChanged: () => void,
  ) {
    this.#runCommand = runCommand;
    this.#isCommandEnabled = isCommandEnabled;
    this.#recent = recent;
    this.#onMenuBarChanged = onMenuBarChanged;
  }

  /** Installs the current menu template as Electron's application menu. */
  install(): void {
    // Windows and Linux draw these menus in the renderer, which activates items by id.
    this.#template = isMac ? this.template() : withMenuItemIds(this.template());
    this.#menu = Menu.buildFromTemplate(this.#template);
    Menu.setApplicationMenu(this.#menu);
    if (!isMac) this.#onMenuBarChanged();
  }

  /**
   * Describes the installed Windows or Linux menus for the renderer's menu bar.
   *
   * @returns an empty menu bar on macOS, which keeps its native menu bar.
   */
  menuBar(): MenuBar {
    const menu = this.#menu;
    if (isMac || !menu) return [];

    return menuBarFromTemplate(this.#template, (id) => menu.getMenuItemById(id)?.enabled ?? false);
  }

  /**
   * Runs one installed menu item, as if it were clicked in the native menu.
   *
   * @param itemId - id from {@link menuBar}.
   * @param window - the window whose menu bar was used.
   */
  activate(itemId: string, window: BrowserWindow): void {
    const item = this.#menu?.getMenuItemById(itemId);
    if (!item?.enabled) return;

    // MenuItem.click runs custom handlers and Electron roles alike.
    item.click(undefined, window, window.webContents);
  }

  /** Rebuilds the installed menu so dynamic submenus such as Open Recent stay current. */
  refresh(): void {
    if (!this.#menu) return;

    this.install();
  }

  /** Re-evaluates command capabilities against the active window and session. */
  updateCommandStates(): void {
    if (!this.#menu) return;

    for (const command of commands) {
      const item = this.#menu.getMenuItemById(command.id);
      if (item) item.enabled = this.#isCommandEnabled(command.id);
    }
    if (!isMac) this.#onMenuBarChanged();
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
          this.#commandItem("app.installCommandLineTool"),
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
    const items = viewMenuItems(this.#runCommand, this.#isCommandEnabled);
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
      ...fileMenuItems(this.#runCommand, this.#isCommandEnabled, this.#recent(), !isMac),
      { type: "separator" },
      this.#commandItem("window.close"),
    ];
    if (!includeQuit) return items;

    return [...items, { type: "separator" }, { role: "quit" }];
  }

  #editItems(includeSettings: boolean): MenuItemConstructorOptions[] {
    return editMenuItems(includeSettings, this.#runCommand, this.#isCommandEnabled);
  }

  #helpItems(includeApplicationItems: boolean): MenuItemConstructorOptions[] {
    return helpMenuItems(includeApplicationItems, this.#runCommand, this.#isCommandEnabled);
  }

  #glyphItems(): MenuItemConstructorOptions[] {
    return [
      this.#commandItem("glyph.addComponent"),
      this.#commandItem("glyph.decomposeComponents"),
      { type: "separator" },
      this.#commandItem("glyph.reverseSelectedContour"),
    ];
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
