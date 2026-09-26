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
