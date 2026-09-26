import type { MenuItemConstructorOptions } from "electron";
import { commandShortcuts, toElectronAccelerator, type CommandId } from "../../shared/commands";
import { commands } from "../commands/Commands";

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

export function fileMenuItems(
  runCommand: (id: CommandId) => void,
  isCommandEnabled: (id: CommandId) => boolean,
): MenuItemConstructorOptions[] {
  return [
    commandMenuItem("file.new", runCommand, isCommandEnabled),
    commandMenuItem("file.open", runCommand, isCommandEnabled),
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
    { type: "separator" },
    item("app.showAbout"),
  ];
}
