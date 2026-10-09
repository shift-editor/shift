import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from "@shift/ui";
import type { RecentDocument } from "@shared/recents";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";
import { getShiftHost } from "@/host/shiftHost";
import type { RecentFileActions } from "./useRecentFileActions";

interface RecentFileMenuProps {
  document: RecentDocument;
  actions: RecentFileActions;
  className?: string;
}

/** The ⋯ menu for one recent file: reveal, copy path, remove. */
export const RecentFileMenu = ({ document, actions, className }: RecentFileMenuProps) => {
  const revealLabel = getShiftHost().platform === "darwin" ? "Reveal in Finder" : "Show in Folder";

  return (
    <Menu modal={false}>
      <Tooltip content="More actions">
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              className={className}
            />
          }
        >
          <VerticalEllipsis className="h-5 w-5 text-icon-subtle" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup>
            {document.missing ? (
              <MenuItem onClick={() => actions.locate(document)}>Locate…</MenuItem>
            ) : (
              <MenuItem onClick={() => actions.reveal(document)}>{revealLabel}</MenuItem>
            )}
            <MenuItem onClick={() => actions.copyPath(document)}>Copy Path</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => actions.remove(document)}>Remove from Recents</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
