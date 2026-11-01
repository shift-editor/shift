import {
  Button,
  ChevronDown,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import { commandShortcuts, type CommandId } from "@shared/commands";
import GhostIcon from "@/assets/brand/ghost.svg";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { getShiftHost } from "@/host/shiftHost";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";
import { useFontSession } from "@/workspace/WorkspaceContext";

/**
 * The left sidebar's header: Shift's mascot, and the font's name, which opens
 * the document's menu (its info, saving and exporting, and settings).
 *
 * @remarks
 * The menu runs the same commands as the application menu, with the same shortcuts.
 * The mascot is drawn like the launcher's: in the text colour with its eyes
 * cut out to the sidebar, so every theme colours it.
 */
export const SidebarBrand = () => {
  const session = useFontSession();
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";
  const settings = useSettingsNavigation();
  const host = getShiftHost();
  const isMac = host.platform === "darwin";
  const run = (commandId: CommandId) => {
    void host.commands.run(commandId).catch((error: unknown) => {
      console.error("document menu command failed", commandId, error);
    });
  };
  const shortcut = (commandId: keyof typeof commandShortcuts) =>
    commandShortcutLabel(commandShortcuts[commandId], isMac);

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-subtle px-3">
      <GhostIcon aria-hidden className="h-6 w-6 shrink-0 text-primary" />
      <Menu modal={false}>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${familyName} document menu`}
              className="min-w-0"
            />
          }
        >
          <span className="truncate text-ui font-medium text-primary">{familyName}</span>
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0" />
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner sideOffset={4} align="start">
            <MenuPopup className="w-56">
              <MenuItem onClick={() => settings.open({ category: "font" })}>Font Info</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => run("file.save")}>
                <span className="flex-1">Save</span>
                <kbd className="font-sans text-muted">{shortcut("file.save")}</kbd>
              </MenuItem>
              <MenuItem onClick={() => run("file.saveAs")}>
                <span className="flex-1">Save As…</span>
                <kbd className="font-sans text-muted">{shortcut("file.saveAs")}</kbd>
              </MenuItem>
              <MenuItem onClick={() => run("file.exportTtf")}>Export TrueType…</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => run("app.showSettings")}>
                <span className="flex-1">Settings…</span>
                <kbd className="font-sans text-muted">{shortcut("app.showSettings")}</kbd>
              </MenuItem>
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    </div>
  );
};
