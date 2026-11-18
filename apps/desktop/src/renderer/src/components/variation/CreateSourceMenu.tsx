import { useMemo, useState, type FormEvent } from "react";
import { useSignalState } from "@shift/editor/signals";
import { addDrawingHere, addDrawingHereCell, drawingHereName } from "@/lib/variation/glyphAxes";
import {
  Button,
  Field,
  FieldControl,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  FieldLabel,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  X,
} from "@shift/ui";
import type { Axis, Source, SourceId } from "@shift/types";
import PlusIcon from "@/assets/general/plus.svg";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import WarningIcon from "@/assets/general/warning.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useAxes } from "@/hooks/useAxes";
import { useSources } from "@/hooks/useSources";
import { axisValue } from "@shift/editor/variation";
import type { ExternalAxisLocation } from "@shift/editor/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { LocationDraftValues } from "./locationDraft";
import { sourceCreationIssue, sourceLocation, suggestedSourceName } from "./sourceCreation";
import { useLocationDraftForm } from "./useLocationDraftForm";

interface CreateSourceMenuProps {
  onSourceCreated?: (sourceId: SourceId) => void;
  onOpenChange?: (open: boolean) => void;
}

const SOURCE_CREATION_ERROR_ID = "create-source-error";

function defaultValues(
  axes: readonly Axis[],
  sources: readonly Source[],
  externalLocation: ExternalAxisLocation,
): LocationDraftValues {
  return {
    name: suggestedSourceName(axes, sources, externalLocation),
    location: Object.fromEntries(
      axes.map((axis) => [axis.id, String(axisValue(externalLocation, axis))]),
    ),
  };
}

export const CreateSourceMenu = ({ onSourceCreated, onOpenChange }: CreateSourceMenuProps) => {
  const editor = useEditor();
  const axes = useAxes();
  const sources = useSources();
  const drawingHereCell = useMemo(() => addDrawingHereCell(editor), [editor]);
  const canAddDrawing = useSignalState(drawingHereCell);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Named when the menu opens: subscribing to it would re-render on every scrub step.
  const [drawingHere, setDrawingHere] = useState<string | null>(null);
  const form = useLocationDraftForm(axes);
  const { values, nameInputRef } = form;

  const handleOpenChange = (nextOpen: boolean) => {
    // Read the location only when opening: subscribing would re-render this menu
    // on every step of a weight scrub just to prefill a form that is closed.
    form.reset(nextOpen ? defaultValues(axes, sources, editor.externalLocationCell.peek()) : null);
    setOpen(nextOpen);
    if (onOpenChange) onOpenChange(nextOpen);
  };

  const trimmedName = values.name.trim();
  const location = sourceLocation(axes, values.location);
  const issue = sourceCreationIssue(values.name, values.location, editor.font.designspace);
  const issues = form.shown(issue);
  const visibleIssue = issues.shown;
  const nameIssue = issues.of("name");
  const locationIssue = issues.of("location");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issue) {
      form.report(issue);
      return;
    }
    if (!location) return;

    const sourceId = editor.createSource(trimmedName, location);
    if (onSourceCreated) onSourceCreated(sourceId);
    handleOpenChange(false);
  };

  const formBody = (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 px-2 py-1">
        <Field className="contents" invalid={!!nameIssue}>
          <FieldLabel htmlFor="create-source-name" tone="primary" className="text-ui">
            Name
          </FieldLabel>
          <FieldControl
            ref={nameInputRef}
            id="create-source-name"
            value={values.name}
            onChange={form.updateName}
            aria-describedby={nameIssue ? SOURCE_CREATION_ERROR_ID : undefined}
            variant="plain"
            className="min-w-0 max-w-full text-right text-ui"
          />
        </Field>

        <div
          className="relative col-span-2 grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2"
          role="group"
          aria-label="Source location"
          aria-invalid={!!locationIssue}
          aria-describedby={locationIssue ? SOURCE_CREATION_ERROR_ID : undefined}
        >
          {locationIssue && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 rounded ring-1 ring-inset ring-error-ring"
              aria-hidden="true"
            />
          )}

          {axes.map((axis) => {
            const axisIssue = issues.forAxis(axis.id);

            return (
              <Field key={axis.id} className="contents" invalid={!!axisIssue}>
                <FieldLabel
                  htmlFor={`create-source-${axis.id}`}
                  tone="primary"
                  className="min-w-0 truncate text-ui"
                  title={axis.name}
                >
                  {axis.name}
                </FieldLabel>
                <FieldControl
                  ref={form.axisInputRef(axis.id)}
                  id={`create-source-${axis.id}`}
                  value={values.location[axis.id] ?? ""}
                  onChange={form.updateAxisValue(axis.id)}
                  aria-describedby={axisIssue ? SOURCE_CREATION_ERROR_ID : undefined}
                  variant="plain"
                  className="min-w-0 max-w-full text-right text-ui"
                  inputMode="decimal"
                />
              </Field>
            );
          })}
        </div>
      </div>

      {visibleIssue && (
        <div
          id={SOURCE_CREATION_ERROR_ID}
          role="alert"
          className="flex items-start gap-1.5 px-2 pb-1.5 text-ui text-error"
        >
          <WarningIcon className="mt-0.5 h-3 w-3 shrink-0 text-error" aria-hidden="true" />
          <span>{visibleIssue.message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 px-2 pb-2 pt-1.5">
        <PopoverClose
          render={
            <Button type="button" className="h-7.5 text-ui">
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="primary" className="h-7.5 text-ui" disabled={!!visibleIssue}>
          Create
        </Button>
      </div>
    </>
  );

  const panelAnchor = useSidebarPanelAnchor();
  const changeMenuOpen = (next: boolean) => {
    if (next) setDrawingHere(drawingHereName(editor));
    setMenuOpen(next);
    if (onOpenChange) onOpenChange(next || open);
  };
  const createSourceForm = (
    <PopoverPortal>
      <PopoverPositioner {...panelAnchor.positioner}>
        <PopoverPopup className="w-50 p-0" initialFocus={nameInputRef}>
          <CreateSourceHeader />
          <form onSubmit={handleSubmit}>{formBody}</form>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverPortal>
  );

  // Where the edited glyph has no drawing, + also offers to draw it there.
  if (canAddDrawing) {
    return (
      <>
        <Menu modal={false} open={menuOpen} onOpenChange={changeMenuOpen}>
          <Tooltip content="Add source or drawing">
            <MenuTrigger
              ref={panelAnchor.triggerRef}
              render={
                <SidebarActionButton label="Add source or drawing">
                  <PlusIcon className="h-3 w-3" />
                </SidebarActionButton>
              }
            />
          </Tooltip>
          <MenuPortal>
            <MenuPositioner sideOffset={4} align="end">
              <MenuPopup>
                <MenuItem onClick={() => void addDrawingHere(editor)}>
                  <span className="flex w-full justify-between gap-6">
                    <span>Add drawing here</span>
                    <span className="text-muted">{drawingHere}</span>
                  </span>
                </MenuItem>
                {axes.length > 0 && (
                  <MenuItem onClick={() => handleOpenChange(true)}>Create source…</MenuItem>
                )}
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
        <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
          {createSourceForm}
        </Popover>
      </>
    );
  }

  if (axes.length === 0) {
    return (
      <Tooltip content="Create source">
        <SidebarActionButton label="Create source" aria-disabled="true">
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip content="Create source">
        <PopoverTrigger
          ref={panelAnchor.triggerRef}
          render={
            <SidebarActionButton label="Create source">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      {createSourceForm}
    </Popover>
  );
};

const CreateSourceHeader = () => (
  <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
    <PopoverTitle>Create Source</PopoverTitle>
    <Tooltip content="Close">
      <PopoverClose variant="icon" aria-label="Close">
        <X className="h-4 w-4" />
      </PopoverClose>
    </Tooltip>
  </div>
);
