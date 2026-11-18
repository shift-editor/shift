import { useMemo, useState } from "react";
import type { Axis } from "@shift/editor/model";
import { EditableSidebarInput } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import type { AxisId } from "@shift/types";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Separator,
  Slider,
  Tooltip,
} from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { glyphAxesCell, removeGlyphAxis, setGlyphAxis } from "@/lib/variation/glyphAxes";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";
import PlusIcon from "@/assets/general/plus.svg";
import { GlyphAxisPopover, refusalMessage, type GlyphAxisPopoverTarget } from "./GlyphAxisPopover";

/**
 * The Designspace tab's Glyph axes section, under Font axes, shown while a
 * glyph is edited: one slider per axis of the glyph's own (a `dot`'s Spread
 * and Strike), which moves where the canvas draws it as the font axis
 * sliders do. A glyph with none shows that it has none, and **+** adds the
 * first. Each row's ⋮ edits the range, renames or removes the axis.
 */
export const GlyphAxesSection = () => {
  const editor = useEditor();
  const canAuthor = useFontSession().mode === "workspace";
  const stateCell = useMemo(() => glyphAxesCell(editor), [editor]);
  const state = useSignalState(stateCell);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<GlyphAxisPopoverTarget | null>(null);
  const anchor = useSidebarPanelAnchor();

  if (!state) return null;

  const addAxis = () => setEditing({ kind: "add" });
  const removeAxis = async (axisId: AxisId) => {
    try {
      await removeGlyphAxis(editor, axisId);
    } catch (error) {
      // Still used by a drawing or component: say which, rather than drop the values.
      setEditing({ kind: "refused", message: refusalMessage(error) });
    }
  };

  return (
    <>
      <Separator className="-mx-1 w-auto" />
      <CollapsibleSection
        title="Glyph axes"
        open={open || editing !== null}
        onOpenChange={setOpen}
        isActive={editing !== null}
        actions={
          <Tooltip content="Add glyph axis">
            <SidebarActionButton
              ref={anchor.triggerRef}
              label="Add glyph axis"
              aria-disabled={canAuthor ? undefined : true}
              onClick={canAuthor ? addAxis : undefined}
            >
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          </Tooltip>
        }
      >
        {state.rows.length === 0 ? (
          <p className="pl-2 text-ui text-muted">No axes of its own</p>
        ) : (
          <div className="flex flex-col gap-1">
            {state.rows.map(({ axis, value }) => (
              <GlyphAxisRow
                key={axis.id}
                axis={axis}
                value={value}
                canAuthor={canAuthor}
                onValueChange={(next) => setGlyphAxis(editor, axis.id, next)}
                onEdit={(focus) => setEditing({ kind: "edit", axisId: axis.id, focus })}
                onRemove={() => void removeAxis(axis.id)}
              />
            ))}
          </div>
        )}
      </CollapsibleSection>
      <GlyphAxisPopover
        target={editing}
        axes={state.rows.map((row) => row.axis)}
        positioner={anchor.positioner}
        onClose={() => setEditing(null)}
      />
    </>
  );
};

interface GlyphAxisRowProps {
  axis: Axis;
  value: number;
  canAuthor: boolean;
  onValueChange: (value: number) => void;
  onEdit: (focus: "name" | "range") => void;
  onRemove: () => void;
}

/** One glyph axis, laid out as a Font axes row: its name, a slider, its value and ⋮. */
const GlyphAxisRow = ({
  axis,
  value,
  canAuthor,
  onValueChange,
  onEdit,
  onRemove,
}: GlyphAxisRowProps) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between px-2">
      <span className="text-ui text-secondary">{axis.name}</span>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_1.5rem] items-center gap-2 pl-2">
      <div
        className="min-w-0 flex-1"
        onDoubleClick={(event) => {
          event.preventDefault();
          onValueChange(axis.default);
        }}
      >
        <Slider
          aria-label={axis.name}
          min={axis.minimum}
          max={axis.maximum}
          step={0.01}
          value={value}
          onValueChange={onValueChange}
        />
      </div>
      <EditableSidebarInput
        ariaLabel={`${axis.name} value`}
        value={value}
        className="w-14"
        onValueChange={onValueChange}
      />
      {canAuthor ? (
        <GlyphAxisActions name={axis.name} onEdit={onEdit} onRemove={onRemove} />
      ) : (
        <span />
      )}
    </div>
  </div>
);

const GlyphAxisActions = ({
  name,
  onEdit,
  onRemove,
}: {
  name: string;
  onEdit: (focus: "name" | "range") => void;
  onRemove: () => void;
}) => (
  <Menu modal={false}>
    <Tooltip content={`Actions for ${name}`}>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}
      >
        <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
      </MenuTrigger>
    </Tooltip>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="start">
        <MenuPopup>
          <MenuItem onClick={() => onEdit("range")}>Edit range</MenuItem>
          <MenuItem onClick={() => onEdit("name")}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={onRemove}>Remove</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
