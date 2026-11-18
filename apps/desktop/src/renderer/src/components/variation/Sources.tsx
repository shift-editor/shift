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
import type { SourceId } from "@shift/types";
import { useSources } from "@/hooks/useSources";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditingSourceIds } from "@/hooks/useEditingSourceIds";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar";
import { listSelectionMode } from "@/hooks/useListSelection";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { OutlineVisibilityButton } from "./OutlineVisibilityButton";
import type { SourcesProps } from "./types";
import type { SourceSelectionMode } from "@shift/editor/types";

import { useMemo } from "react";
import { useSignalState } from "@shift/editor/signals";
import { deleteDrawing, glyphDrawingsCell, selectDrawing } from "@/lib/variation/glyphAxes";
import type { GlyphDrawingRow as GlyphDrawingRowState } from "@/types/glyphAxes";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";
import LocationPin from "@/assets/general/location-pin.svg";

export const Sources = ({ canAuthor, outlineControls }: SourcesProps) => {
  const editor = useEditor();
  const sources = useSources();
  const drawingsCell = useMemo(() => glyphDrawingsCell(editor), [editor]);
  const drawings = useSignalState(drawingsCell);
  const activeSourceId = useActiveSourceId();
  const editingSourceIds = useEditingSourceIds();
  const settings = useSettingsNavigation();

  if (sources.length === 0 && drawings.length === 0) return null;

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
    <div
      role="group"
      aria-label="Sources"
      className="flex justify-start items-start flex-col gap-1"
    >
      {sources.map((source, index) => {
        const target = { kind: "source", sourceId: source.id } as const;
        const visible = outlineControls?.targets.hasSource(source.id) ?? false;
        const inherited = outlineControls?.inheritedTargets.hasSource(source.id) ?? false;
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
            onClick={(event) => selectSource(source.id, listSelectionMode(event))}
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
      {drawings.map((drawing) => (
        <GlyphDrawingRow
          key={drawing.layerId}
          drawing={drawing}
          canAuthor={canAuthor}
          onSelect={() => selectDrawing(editor, drawing.layerId)}
          onDelete={() => void deleteDrawing(editor, drawing.layerId)}
        />
      ))}
    </div>
  );
};

/**
 * A drawing of the edited glyph off the font's sources, after the font's
 * sources: named by where it sits, with a pin saying it belongs to this
 * glyph alone. Selecting it edits it, as selecting a source does.
 */
const GlyphDrawingRow = ({
  drawing,
  canAuthor,
  onSelect,
  onDelete,
}: {
  drawing: GlyphDrawingRowState;
  canAuthor: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) => (
  <SidebarActionRow
    data-testid={`glyph-drawing-${drawing.layerId}`}
    isActive={drawing.active}
    isSelected={drawing.active}
    onClick={onSelect}
    actions={<DrawingActionsMenu name={drawing.name} disabled={!canAuthor} onDelete={onDelete} />}
  >
    <span className="min-w-0 flex-1 truncate text-left" title={drawing.name}>
      {drawing.name}
    </span>
    {/* Always shown, unlike the row's actions; decorative, so the row keeps its name. */}
    <span title="This glyph only" aria-hidden className="mr-1 flex shrink-0">
      <LocationPin className="h-3.5 w-3.5 text-icon-subtle" />
    </span>
  </SidebarActionRow>
);

const DrawingActionsMenu = ({
  name,
  disabled,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  onDelete: () => void;
}) => {
  if (disabled) {
    return (
      <Tooltip content="Drawing actions unavailable in preview mode">
        <SidebarActionButton label={`Actions for ${name}`} aria-disabled>
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip content="Drawing actions">
        <MenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}
        >
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup>
            <MenuItem onClick={onDelete}>Delete</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
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
      <Tooltip content="Source actions unavailable in preview mode">
        <SidebarActionButton label={`Actions for ${sourceName}`} aria-disabled>
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip content="Edit source">
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${sourceName}`} />
          }
        >
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup>
            <MenuItem onClick={onEdit}>Edit</MenuItem>
            {!isDefaultSource && (
              <>
                <MenuSeparator />
                <MenuItem disabled={!canDelete} onClick={onDelete}>
                  Delete
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
