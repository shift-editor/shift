import { useState, type FormEvent } from "react";
import type { Axis } from "@shift/editor/model";
import {
  Button,
  Field,
  FieldControl,
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
import PlusIcon from "@/assets/general/plus.svg";
import WarningIcon from "@/assets/general/warning.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { useEditor } from "@/workspace/WorkspaceContext";
import {
  createGlyphSource,
  currentGlyphSourceValues,
  glyphSourceAxes,
  glyphSourceIssue,
} from "./glyphSourceCreation";
import { useLocationDraftForm } from "./useLocationDraftForm";

const ISSUE_ID = "new-glyph-source-issue";

/**
 * The Glyph sources section's **+** and the New glyph source panel it opens
 * beside the sidebar: one field per axis, the font's then the glyph's own,
 * prefilled with where the sliders sit. Create adds a glyph source there,
 * starting from the outline drawn there, moves the sliders there and edits
 * it. A location the glyph already has a source or glyph source at disables
 * Create and says which one is there.
 */
export const NewGlyphSourcePanel = () => {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  // Read when the panel opens: the glyph's axes don't change while it is open.
  const [axes, setAxes] = useState<readonly Axis[]>([]);
  const form = useLocationDraftForm(axes);
  const panelAnchor = useSidebarPanelAnchor();

  const changeOpen = (next: boolean) => {
    if (next) {
      const fields = glyphSourceAxes(editor);
      setAxes(fields);
      form.reset(currentGlyphSourceValues(editor, fields));
    } else {
      form.reset(null);
    }
    setOpen(next);
  };

  const issue = open ? glyphSourceIssue(editor, axes, form.values.location) : null;
  // Taken locations show at once; a field's problem shows once Create is pressed.
  const occupied = issue?.kind === "location" ? issue : null;
  const shown = form.shown(issue);
  const visibleIssue = occupied ?? shown.shown;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issue) {
      form.report(issue);
      return;
    }

    await createGlyphSource(editor, axes, form.values.location);
    changeOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={changeOpen} modal={false}>
      <Tooltip content="New glyph source">
        <PopoverTrigger
          ref={panelAnchor.triggerRef}
          render={
            <SidebarActionButton label="New glyph source">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner {...panelAnchor.positioner}>
          <PopoverPopup className="w-50 p-0">
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>New Glyph Source</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>

            <form onSubmit={(event) => void submit(event)}>
              <div
                className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 px-2 py-1"
                role="group"
                aria-label="Glyph source location"
              >
                {axes.map((axis) => {
                  const axisIssue = shown.forAxis(axis.id);
                  return (
                    <Field key={axis.id} className="contents" invalid={!!axisIssue}>
                      <FieldLabel
                        htmlFor={`new-glyph-source-${axis.id}`}
                        tone="primary"
                        className="min-w-0 truncate text-ui"
                        title={axis.name}
                      >
                        {axis.name}
                      </FieldLabel>
                      <FieldControl
                        ref={form.axisInputRef(axis.id)}
                        id={`new-glyph-source-${axis.id}`}
                        value={form.values.location[axis.id] ?? ""}
                        onChange={form.updateAxisValue(axis.id)}
                        aria-describedby={axisIssue ? ISSUE_ID : undefined}
                        variant="plain"
                        className="min-w-0 max-w-full text-right text-ui"
                        inputMode="decimal"
                      />
                    </Field>
                  );
                })}
              </div>

              {visibleIssue && (
                <div
                  id={ISSUE_ID}
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
                <Button
                  type="submit"
                  variant="primary"
                  className="h-7.5 text-ui"
                  disabled={!!visibleIssue}
                >
                  Create
                </Button>
              </div>
            </form>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};
