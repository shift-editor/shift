import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@shift/ui";
import type { SourceId } from "@shift/types";
import { useSources } from "@/hooks/useSources";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarActionRow } from "@/components/sidebar";

import VerticalElipsis from "@/assets/vertical-ellipsis.svg";

export const Sources = () => {
  const sources = useSources();
  const activeSourceId = useActiveSourceId();
  const editor = useEditor();

  if (sources.length === 0) return null;

  const deleteSource = (sourceId: SourceId) => {
    const fallbackSource = sources.find((source) => source.id !== sourceId);
    if (activeSourceId === sourceId && fallbackSource) {
      editor.selectSource(fallbackSource.id);
    }
    editor.font.deleteSource(sourceId);
  };

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((s) => (
        <SidebarActionRow
          key={s.id}
          isActive={s.id === activeSourceId}
          onClick={() => editor.selectSource(s.id)}
          contentClassName="h-6 text-ui"
          actions={
            <SourceActionsMenu
              sourceName={s.name}
              canDelete={sources.length > 1}
              onDelete={() => deleteSource(s.id)}
            />
          }
        >
          {s.name}
        </SidebarActionRow>
      ))}
    </div>
  );
};

const SourceActionsMenu = ({
  sourceName,
  canDelete,
  onDelete,
}: {
  sourceName: string;
  canDelete: boolean;
  onDelete: () => void;
}) => (
  <Menu modal={false}>
    <MenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 p-0.5"
          aria-label={`Actions for ${sourceName}`}
        />
      }
    >
      <VerticalElipsis className="h-5 w-5" />
    </MenuTrigger>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem>Rename source</MenuItem>
          <MenuItem>Duplicate source</MenuItem>
          <MenuItem variant="danger" disabled={!canDelete} onClick={onDelete}>
            Delete source
          </MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
