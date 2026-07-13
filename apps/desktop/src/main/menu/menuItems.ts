import type { MenuItemConstructorOptions } from "electron";
import type { CommandId } from "../../shared/commands";
import { commands } from "../commands/Commands";

export function commandMenuItem(
  id: CommandId,
  runCommand: (id: CommandId) => void,
): MenuItemConstructorOptions {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unknown menu command: ${id}`);

  return {
    label: command.label,
    accelerator: command.accelerator,
    click: () => runCommand(id),
  };
}

export function fileMenuItems(runCommand: (id: CommandId) => void): MenuItemConstructorOptions[] {
  return [
    commandMenuItem("file.new", runCommand),
    commandMenuItem("file.open", runCommand),
    { type: "separator" },
    commandMenuItem("file.save", runCommand),
    commandMenuItem("file.saveAs", runCommand),
    { type: "separator" },
    {
      label: "Export",
      submenu: [commandMenuItem("file.exportTtf", runCommand)],
    },
  ];
}
