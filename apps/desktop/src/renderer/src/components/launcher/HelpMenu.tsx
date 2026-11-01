import { Fragment } from "react";
import {
  Button,
  CircleHelp,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from "@shift/ui";
import { helpCommandGroups, helpCommandLabels, type HelpCommandId } from "@shared/commands";
import { getShiftHost } from "@/host/shiftHost";

/** The launcher's `?` button: a menu of the Help menu's commands. */
export const HelpMenu = ({ className }: { className?: string }) => (
  // The ghost button takes its icon colour from here.
  <div className={cn("text-secondary", className)}>
    <Menu modal={false}>
      <Tooltip content="Help">
        <MenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Help" className="size-6.5 p-0" />}
        >
          <CircleHelp aria-hidden className="size-4.5" strokeWidth={1.6} />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner side="top" align="end" sideOffset={4}>
          <MenuPopup aria-label="Help" className="min-w-48">
            {helpCommandGroups.map((group, index) => (
              <Fragment key={group[0]}>
                {index > 0 && <MenuSeparator />}
                {group.map((id) => (
                  <MenuItem key={id} onClick={() => runHelpCommand(id)}>
                    {helpCommandLabels[id]}
                  </MenuItem>
                ))}
              </Fragment>
            ))}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  </div>
);

async function runHelpCommand(id: HelpCommandId): Promise<void> {
  try {
    await getShiftHost().commands.run(id);
  } catch (error) {
    console.error(`help command ${id} failed`, error);
  }
}
