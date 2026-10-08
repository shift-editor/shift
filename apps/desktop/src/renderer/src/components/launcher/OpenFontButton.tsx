import {
  Button,
  ChevronDown,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@shift/ui";
import { commandShortcuts, type CommandId } from "@shared/commands";
import { getShiftHost } from "@/host/shiftHost";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";

/**
 * The launcher's Open Font button.
 *
 * macOS opens files and font packages from one panel. Windows and Linux cannot
 * pick files and folders together, so there a menu beside the button also
 * offers UFO and Glyphs packages, which are folders.
 */
export const OpenFontButton = () => {
  const isMac = getShiftHost().platform === "darwin";
  const openShortcut = commandShortcutLabel(commandShortcuts["file.open"], isMac);

  const openButton = (
    <Button
      variant="ghost"
      size="sm"
      className="rounded-md text-sm font-medium"
      onClick={() => runCommand("file.open")}
    >
      Open Font…
      <span aria-hidden="true" className="ml-2">
        {openShortcut}
      </span>
    </Button>
  );
  if (isMac) return openButton;

  const packageShortcut = commandShortcutLabel(commandShortcuts["file.openFolder"], isMac);

  return (
    <div className="flex items-center">
      {openButton}
      <Menu modal={false}>
        <Tooltip>
          <TooltipTrigger>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More ways to open"
                  className="data-[popup-open]:bg-hover/50"
                />
              }
            >
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </MenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More ways to open</TooltipContent>
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
                <kbd className="font-sans text-sm text-muted">{packageShortcut}</kbd>
              </MenuItem>
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    </div>
  );
};

async function runCommand(id: CommandId): Promise<void> {
  try {
    await getShiftHost().commands.run(id);
  } catch (error) {
    console.error("opening a font failed", error);
  }
}
