import type { MenuItemConstructorOptions } from "electron";
import { commandShortcuts, toElectronAccelerator, type CommandId } from "../../shared/commands";
import { commands } from "../commands/Commands";
import { pathBasename, recentFolderLabels, type RecentDocument } from "../../shared/recents";

/** Recent files and actions shown in File → Open Recent. */
export type RecentMenu = {
  documents: readonly RecentDocument[];
  open: (path: string) => void;
  clear: () => void;
};

export function commandMenuItem(
  id: CommandId,
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
): MenuItemConstructorOptions {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unknown menu command: ${id}`);

  const shortcut = commandShortcuts[id];

  return {
    id,
    label: command.label,
    accelerator: shortcut ? toElectronAccelerator(shortcut) : undefined,
    enabled: isCommandEnabled(id),
    click: () => runCommand(id),
  };
}

/**
 * Builds the File menu.
 *
 * @param includeOpenFolder - adds Open Font Folder… where the Open dialog cannot
 * select folders (Windows and Linux).
 */
export function fileMenuItems(
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
  recent: RecentMenu,
  includeOpenFolder: boolean,
): MenuItemConstructorOptions[] {
  return [
    commandMenuItem("file.new", runCommand, isCommandEnabled),
    commandMenuItem("file.open", runCommand, isCommandEnabled),
    ...(includeOpenFolder
      ? [commandMenuItem("file.openFolder", runCommand, isCommandEnabled)]
      : []),
    openRecentMenuItem(recent),
    { type: "separator" },
    commandMenuItem("file.save", runCommand, isCommandEnabled),
    commandMenuItem("file.saveAs", runCommand, isCommandEnabled),
    { type: "separator" },
    {
      label: "Export",
      submenu: [commandMenuItem("file.exportTtf", runCommand, isCommandEnabled)],
    },
  ];
}

/**
 * Builds File → Open Recent: one item per recent file, then Clear Menu.
 *
 * @remarks
 * Files that share a name are suffixed with the parent folder that tells them
 * apart. Missing files stay listed but disabled until they are located or cleared.
 */
export function openRecentMenuItem(recent: RecentMenu): MenuItemConstructorOptions {
  const folders = recentFolderLabels(recent.documents.map((document) => document.path));
  const documentItems = recent.documents.map((document): MenuItemConstructorOptions => {
    const name = pathBasename(document.path);
    const folder = folders.get(document.path);
    return {
      label: folder ? `${name} — ${folder}` : name,
      enabled: !document.missing,
      click: () => recent.open(document.path),
    };
  });

  return {
    label: "Open Recent",
    submenu: [
      ...documentItems,
      ...(documentItems.length > 0 ? [{ type: "separator" as const }] : []),
      { label: "Clear Menu", enabled: documentItems.length > 0, click: () => recent.clear() },
    ],
  };
}

/**
 * Builds the Edit menu's command items.
 *
 * @param includeSettings - whether Settings lives in Edit, as on Windows and Linux.
 */
export function editMenuItems(
  includeSettings: boolean,
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
): MenuItemConstructorOptions[] {
  const item = (id: CommandId) => commandMenuItem(id, runCommand, isCommandEnabled);
  const items: MenuItemConstructorOptions[] = [
    item("edit.undo"),
    item("edit.redo"),
    { type: "separator" },
    item("edit.cut"),
    item("edit.copy"),
    item("edit.paste"),
    item("edit.deleteSelection"),
    { type: "separator" },
    item("edit.selectAll"),
  ];
  if (!includeSettings) return items;

  return [...items, { type: "separator" }, item("app.showSettings")];
}

/** Builds the View menu's zoom and Interface Size items. */
export function viewMenuItems(
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
): MenuItemConstructorOptions[] {
  const item = (id: CommandId, label?: string) => {
    const menuItem = commandMenuItem(id, runCommand, isCommandEnabled);
    return label ? { ...menuItem, label } : menuItem;
  };

  return [
    item("view.zoomIn"),
    item("view.zoomOut"),
    { type: "separator" },
    {
      label: "Interface Size",
      submenu: [
        item("ui.increaseSize", "Increase"),
        item("ui.decreaseSize", "Decrease"),
        item("ui.resetSize", "Reset"),
      ],
    },
  ];
}

/**
 * Builds the Help menu's community, support, and application items.
 *
 * @param includeApplicationItems - whether About and update checks live in Help, as on
 *   Windows and Linux.
 */
export function helpMenuItems(
  includeApplicationItems: boolean,
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
): MenuItemConstructorOptions[] {
  const item = (id: CommandId) => commandMenuItem(id, runCommand, isCommandEnabled);
  const items: MenuItemConstructorOptions[] = [
    item("help.openWebsite"),
    item("help.openDiscord"),
    item("help.openX"),
    { type: "separator" },
    item("help.reportIssue"),
    item("help.showLogs"),
    item("help.emailFeedback"),
  ];
  if (!includeApplicationItems) return items;

  return [
    ...items,
    { type: "separator" },
    item("app.checkForUpdates"),
    item("app.installCommandLineTool"),
    { type: "separator" },
    item("app.showAbout"),
  ];
}
