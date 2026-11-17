import { useMemo, useRef, useState } from "react";
import type { Axis } from "@shift/editor/model";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Separator,
  Slider,
  Tooltip,
} from "@shift/ui";
import { EditableSidebarInput } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import {
  selectedComponentLocationCell,
  setSelectedComponentAxis,
} from "@/lib/variation/componentLocation";
import type { FollowedComponentAxis } from "@/types/componentLocation";
import PlusIcon from "@/assets/general/plus.svg";

/**
 * The Designspace tab's component section, shown only while components are
 * selected at a source and titled with the glyph they draw: one row per axis
 * they set, which draws their base glyph at that value instead of where the
 * glyph they sit in is drawn. **+** sets another axis; **−** stops setting
 * one. Each source keeps its own: switching source in the left sidebar shows
 * that source's rows.
 *
 * @remarks
 * Dragging a slider is one undo step. Components that differ on an axis show
 * Mixed until a value sets them all.
 */
export const ComponentLocationSection = () => {
  const editor = useEditor();
  const stateCell = useMemo(() => selectedComponentLocationCell(editor), [editor]);
  const state = useSignalState(stateCell);
  const [open, setOpen] = useState(true);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const drag = useRef<{ finish(): void } | null>(null);

  if (!state) return null;

  const setAxis = (axis: Axis, value: number) =>
    void setSelectedComponentAxis(editor, axis.id, value);
  const unsetAxis = (axis: Axis) => void editor.setSelectedComponentsAxis(axis.id, null);

  const beginDrag = () => {
    if (drag.current) return;
    try {
      drag.current = editor.history.begin("Set Component Location");
    } catch {
      // Another action holds history; each change is then its own step.
      drag.current = null;
    }
  };
  const endDrag = () => {
    drag.current?.finish();
    drag.current = null;
  };

  return (
    <>
      <Separator className="-mx-1 w-auto" />
      <CollapsibleSection
        title={state.title}
        open={open}
        onOpenChange={setOpen}
        isActive={addMenuOpen}
        actions={
          <AddAxisMenu
            onOpenChange={setAddMenuOpen}
            followed={state.followed}
            onAdd={(entry) => setAxis(entry.axis, entry.follows)}
          />
        }
      >
        <div className="flex flex-col gap-1">
          {state.set.map(({ axis, value }) => (
            <div key={axis.id} className="flex flex-col gap-1">
              <span className="px-2 text-ui text-secondary">{axis.name}</span>
              <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_1.5rem] items-center gap-2 pl-2">
                <div onPointerDown={beginDrag}>
                  <Slider
                    aria-label={`${axis.name} of the selected components`}
                    min={axis.minimum}
                    max={axis.maximum}
                    step={1}
                    value={value ?? axis.kind.default}
                    // Mixed: no single value to point at, so no thumb or fill until a drag sets one.
                    thumbClassName={value === null ? "invisible" : undefined}
                    indicatorClassName={value === null ? "invisible" : undefined}
                    onValueChange={(next) => setAxis(axis, next)}
                    onValueCommitted={endDrag}
                  />
                </div>
                <EditableSidebarInput
                  ariaLabel={`${axis.name} value`}
                  value={value}
                  placeholder="Mixed"
                  tooltip={value === null ? "The selected components differ" : undefined}
                  className="w-14"
                  onValueChange={(next) => setAxis(axis, next)}
                />
                <Tooltip content={`Follow the glyph on ${axis.name}`}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Stop setting ${axis.name}`}
                    onClick={() => unsetAxis(axis)}
                  >
                    <MinusIcon />
                  </Button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </>
  );
};

function AddAxisMenu({
  followed,
  onAdd,
  onOpenChange,
}: {
  followed: readonly FollowedComponentAxis[];
  onAdd: (entry: FollowedComponentAxis) => void;
  /** Keeps the section's header showing the + while the menu is open. */
  onOpenChange: (open: boolean) => void;
}) {
  // Every axis set: the + stays, disabled, so the section always shows where axes are added.
  if (followed.length === 0) {
    return (
      <Tooltip content="Every axis is set">
        <SidebarActionButton label="Every axis is set" aria-disabled>
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false} onOpenChange={onOpenChange}>
      <Tooltip content="Set an axis">
        <MenuTrigger
          render={
            <SidebarActionButton label="Set an axis on the selected components">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="end">
          <MenuPopup>
            {followed.map((entry) => (
              <MenuItem key={entry.axis.id} onClick={() => onAdd(entry)}>
                <span className="flex w-full justify-between gap-6">
                  <span>{entry.axis.name}</span>
                  <span className="text-muted">{entry.follows}</span>
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}

const MinusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-sidebar-icon">
    <path d="M2.5 7h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
