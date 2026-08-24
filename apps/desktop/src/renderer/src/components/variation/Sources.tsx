import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import type { SourceId } from "@shift/types";
import { useSources } from "@/hooks/useSources";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarActionRow } from "@/components/sidebar";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";

import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

export const Sources = ({ canAuthor }: { canAuthor: boolean }) => {
  const sources = useSources();
  const activeSourceId = useActiveSourceId();
  const editor = useEditor();
  const settings = useSettingsNavigation();

  if (sources.length === 0) return null;

  const selectSource = (sourceId: SourceId) => {
    if (canAuthor) {
      editor.selectSourceForEditing(sourceId);
      return;
    }

    editor.selectSource(sourceId);
  };

  const deleteSource = (sourceId: SourceId) => {
    const fallbackSource = sources.find((source) => source.id !== sourceId);
    if (activeSourceId === sourceId && fallbackSource) {
      selectSource(fallbackSource.id);
    }
    editor.font.deleteSource(sourceId);
  };

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((s) => (
        <SidebarActionRow
          key={s.id}
          data-testid={`source-${s.id}`}
          isActive={s.id === activeSourceId}
          onClick={() => selectSource(s.id)}
          contentClassName="h-6 text-ui"
          actions={
            canAuthor ? (
              <SourceActionsMenu
                sourceName={s.name}
                isDefaultSource={s.id === editor.font.defaultSource.id}
                canDelete={sources.length > 1 && s.id !== editor.font.defaultSource.id}
                onEdit={() => settings.open({ category: "sources", sourceId: s.id })}
                onDelete={() => deleteSource(s.id)}
              />
            ) : undefined
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
  isDefaultSource,
  canDelete,
  onEdit,
  onDelete,
}: {
  sourceName: string;
  isDefaultSource: boolean;
  canDelete: boolean;
  onEdit: () => void;
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
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuSeparator />
          <MenuItem variant="danger" disabled={!canDelete} onClick={onDelete}>
            {isDefaultSource ? "Default source cannot be deleted" : "Delete source"}
          </MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
