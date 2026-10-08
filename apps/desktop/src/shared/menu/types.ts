/**
 * The Windows and Linux application menus, described for the renderer's menu bar.
 *
 * @remarks
 * Main builds this from the same template it installs as the native menu, so
 * the drawn menus and keyboard accelerators never disagree. macOS keeps its
 * native menu bar and never receives one.
 */
export type MenuBar = readonly MenuBarItem[];

/**
 * One entry in a {@link MenuBar}.
 *
 * - `command`: runs through `menu.activate` with its `id`.
 * - `submenu`: opens `items`; top-level submenus carry an `accessKey`.
 * - `separator`: a divider between groups.
 */
export type MenuBarItem =
  | {
      kind: "command";
      id: string;
      label: string;
      /** Shortcut as the platform shows it, such as `Ctrl+Shift+O`. */
      shortcut: string | null;
      enabled: boolean;
    }
  | {
      kind: "submenu";
      id: string;
      label: string;
      /** Letter that opens the menu from the keyboard, or null below the top level. */
      accessKey: string | null;
      enabled: boolean;
      items: readonly MenuBarItem[];
    }
  | { kind: "separator"; id: string };

/** Colours Electron uses for the native window controls drawn over the title bar. */
export type TitleBarColors = {
  /** Background behind the window controls; matches the toolbar. */
  background: string;
  /** Colour of the control glyphs. */
  symbol: string;
};

/** A window button Shift draws itself on Linux. */
export type WindowButton = "minimize" | "maximize" | "close";

/** Which window buttons sit at the start and end of the title-bar row, in order. */
export type WindowButtonLayout = {
  start: readonly WindowButton[];
  end: readonly WindowButton[];
};
