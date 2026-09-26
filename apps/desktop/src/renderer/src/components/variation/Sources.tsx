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
  TooltipContent,
  TooltipTrigger,
} from "@shift/ui";
import type { SourceId } from "@shift/types";
import { useSources } from "@/hooks/useSources";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditingSourceIds } from "@/hooks/useEditingSourceIds";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { OutlineVisibilityButton } from "./OutlineVisibilityButton";
import type { SourcesProps } from "./types";
import type { SourceSelectionMode } from "@shift/editor/types";

import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

export const Sources = ({ canAuthor, outlineControls }: SourcesProps) => {
  const sources = useSources();
  const activeSourceId = useActiveSourceId();
  const editingSourceIds = useEditingSourceIds();
  const editor = useEditor();
  const settings = useSettingsNavigation();

  if (sources.length === 0) return null;

  const selectSource = (sourceId: SourceId, mode: SourceSelectionMode = "single") => {
    if (canAuthor) {
      editor.selectSourceForEditing(sourceId, mode);
      return;
    }

    editor.selectSource(sourceId);
  };

  const deleteSource = (sourceId: SourceId) => {
    const fallbackSource = sources.find((source) => source.id !== sourceId);
    if (activeSourceId === sourceId && fallbackSource) {
      selectSource(fallbackSource.id);
    } else if (editingSourceIds.has(sourceId)) {
      editor.selectSourceForEditing(sourceId, "toggle");
    }

    editor.font.deleteSource(sourceId);
  };

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      {sources.map((source, index) => {
        const target = { kind: "source", sourceId: source.id } as const;
        const visible =
          outlineControls?.targets.some(
            (candidate) => candidate.kind === "source" && candidate.sourceId === source.id,
          ) ?? false;
        const inherited =
          outlineControls?.inheritedTargets.some(
            (candidate) => candidate.kind === "source" && candidate.sourceId === source.id,
          ) ?? false;
        const selected = editingSourceIds.has(source.id);
        const joinsPrevious = selected && index > 0 && editingSourceIds.has(sources[index - 1].id);
        const joinsNext =
          selected && index < sources.length - 1 && editingSourceIds.has(sources[index + 1].id);

        return (
          <SidebarActionRow
            key={source.id}
            data-testid={`source-${source.id}`}
            isActive={source.id === activeSourceId}
            isSelected={selected}
            joinsPrevious={joinsPrevious}
            joinsNext={joinsNext}
            onClick={(event) => {
              const mode: SourceSelectionMode = event.shiftKey
                ? "range"
                : event.metaKey || event.ctrlKey
                  ? "toggle"
                  : "single";
              selectSource(source.id, mode);
            }}
            actions={
              <>
                {outlineControls && source.id !== activeSourceId && (
                  <OutlineVisibilityButton
                    visible={visible}
                    inherited={inherited}
                    label="outline"
                    subject={`${source.name} source`}
                    onClick={() => outlineControls.onToggle(target)}
                  />
                )}
                <SourceActionsMenu
                  sourceName={source.name}
                  disabled={!canAuthor}
                  isDefaultSource={source.id === editor.font.defaultSource.id}
                  canDelete={sources.length > 1 && source.id !== editor.font.defaultSource.id}
                  onEdit={() => settings.open({ category: "sources", sourceId: source.id })}
                  onDelete={() => deleteSource(source.id)}
                />
              </>
            }
          >
            <span className="min-w-0 flex-1 truncate text-left">{source.name}</span>
          </SidebarActionRow>
        );
      })}
    </div>
  );
};

const SourceActionsMenu = ({
  sourceName,
  disabled,
  isDefaultSource,
  canDelete,
  onEdit,
  onDelete,
}: {
  sourceName: string;
  disabled: boolean;
  isDefaultSource: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarActionButton label={`Actions for ${sourceName}`} aria-disabled>
            <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
          </SidebarActionButton>
        </TooltipTrigger>
        <TooltipContent>Source actions unavailable in preview mode</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip>
        <TooltipTrigger>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${sourceName}`} />
            }
          >
            <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
          </MenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{`Edit source`}</TooltipContent>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup>
            <MenuItem onClick={onEdit}>Edit</MenuItem>
            {!isDefaultSource && (
              <>
                <MenuSeparator />
                <MenuItem variant="danger" disabled={!canDelete} onClick={onDelete}>
                  "Delete source"
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
