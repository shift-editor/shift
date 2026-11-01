import {
  Button,
  ChevronDown,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Tooltip,
} from "@shift/ui";
import { commandShortcuts, type CommandId } from "@shared/commands";
import { getShiftHost } from "@/host/shiftHost";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";

const SHORTCUT_CLASS = "font-sans text-sm/4 font-medium";

/**
 * The launcher header's actions: Open… then New font, each with its shortcut.
 *
 * @remarks
 * macOS opens files and font packages from one panel. Windows and Linux cannot
 * pick files and folders together, so there a menu beside Open… also offers
 * UFO and Glyphs packages, which are folders.
 */
export const LauncherActions = () => {
  const isMac = getShiftHost().platform === "darwin";

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="action" onClick={() => runCommand("file.open")}>
        Open…
        <kbd aria-hidden="true" className={cn(SHORTCUT_CLASS, "text-secondary")}>
          {commandShortcutLabel(commandShortcuts["file.open"], isMac)}
        </kbd>
      </Button>
      {!isMac && <MoreWaysToOpen />}
      <Button variant="primary" size="action" onClick={() => runCommand("file.new")}>
        New font
        <kbd aria-hidden="true" className={cn(SHORTCUT_CLASS, "text-on-accent/90")}>
          {commandShortcutLabel(commandShortcuts["file.new"], isMac)}
        </kbd>
      </Button>
    </div>
  );
};

/** Windows and Linux: a menu of the two open panels, files or font folders. */
const MoreWaysToOpen = () => {
  const openShortcut = commandShortcutLabel(commandShortcuts["file.open"], false);
  const folderShortcut = commandShortcutLabel(commandShortcuts["file.openFolder"], false);

  return (
    <Menu modal={false}>
      <Tooltip content="More ways to open">
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label="More ways to open"
              className="size-7.5 data-[popup-open]:bg-hover/50"
            />
          }
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner side="bottom" align="end" sideOffset={4}>
          <MenuPopup aria-label="Open" className="min-w-64">
            <MenuItem onClick={() => runCommand("file.open")} className="justify-between gap-6">
              <span>Font File…</span>
              <kbd className="font-sans text-sm text-muted">{openShortcut}</kbd>
            </MenuItem>
            <MenuItem
              onClick={() => runCommand("file.openFolder")}
              className="justify-between gap-6"
            >
              <span>Font Folder…</span>
              <kbd className="font-sans text-sm text-muted">{folderShortcut}</kbd>
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};

async function runCommand(id: CommandId): Promise<void> {
  try {
    await getShiftHost().commands.run(id);
  } catch (error) {
    console.error(`launcher command ${id} failed`, error);
  }
}
