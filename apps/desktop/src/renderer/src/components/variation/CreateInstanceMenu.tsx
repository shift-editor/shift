import { useState, type FormEvent } from "react";
import type { NamedInstanceId } from "@shift/types";
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
import { useExternalAxes } from "@/hooks/useAxes";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { useFont } from "@/workspace/WorkspaceContext";
import { instanceCreationIssue, instanceLocation, suggestedInstanceName } from "./instanceCreation";
import { useLocationDraftForm } from "./useLocationDraftForm";

interface CreateInstanceMenuProps {
  onInstanceCreated?: (instanceId: NamedInstanceId) => void;
  onOpenChange?: (open: boolean) => void;
}

const INSTANCE_CREATION_ERROR_ID = "create-instance-error";

export const CreateInstanceMenu = ({
  onInstanceCreated,
  onOpenChange,
}: CreateInstanceMenuProps) => {
  const font = useFont();
  const axes = useExternalAxes();
  const instances = useNamedInstances();
  const [open, setOpen] = useState(false);
  const form = useLocationDraftForm(axes);
  const { values, nameInputRef } = form;

  const handleOpenChange = (nextOpen: boolean) => {
    const fresh = {
      name: suggestedInstanceName(instances),
      location: Object.fromEntries(axes.map((axis) => [axis.id, String(axis.default)])),
    };
    form.reset(nextOpen ? fresh : null);
    setOpen(nextOpen);
    if (onOpenChange) onOpenChange(nextOpen);
  };

  const issue = instanceCreationIssue(values.name, values.location, axes, instances);
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

    const location = instanceLocation(axes, values.location);
    if (!location) return;

    const instanceId = font.createNamedInstance({
      name: values.name.trim(),
      location,
    });
    if (onInstanceCreated) onInstanceCreated(instanceId);
    handleOpenChange(false);
  };

  if (axes.length === 0) {
    return (
      <Tooltip content="Create instance">
        <SidebarActionButton label="Create instance" aria-disabled="true">
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip content="Create instance">
        <PopoverTrigger
          render={
            <SidebarActionButton label="Create instance">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner sideOffset={4} align="start">
          <PopoverPopup className="w-50 p-0" initialFocus={nameInputRef}>
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>Create Instance</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 px-2 py-1">
                <Field className="contents" invalid={!!nameIssue}>
                  <FieldLabel htmlFor="create-instance-name" tone="primary" className="text-ui">
                    Name
                  </FieldLabel>
                  <FieldControl
                    ref={nameInputRef}
                    id="create-instance-name"
                    value={values.name}
                    onChange={form.updateName}
                    aria-describedby={nameIssue ? INSTANCE_CREATION_ERROR_ID : undefined}
                    variant="plain"
                    className="min-w-0 max-w-full text-right text-ui"
                  />
                </Field>

                <div
                  className="relative col-span-2 grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2"
                  role="group"
                  aria-label="Instance location"
                  aria-invalid={!!locationIssue}
                  aria-describedby={locationIssue ? INSTANCE_CREATION_ERROR_ID : undefined}
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
                          htmlFor={`create-instance-${axis.id}`}
                          tone="primary"
                          className="min-w-0 truncate text-ui"
                          title={axis.name}
                        >
                          {axis.name}
                        </FieldLabel>
                        <FieldControl
                          ref={form.axisInputRef(axis.id)}
                          id={`create-instance-${axis.id}`}
                          value={values.location[axis.id] ?? ""}
                          onChange={form.updateAxisValue(axis.id)}
                          aria-describedby={axisIssue ? INSTANCE_CREATION_ERROR_ID : undefined}
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
                  id={INSTANCE_CREATION_ERROR_ID}
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
