import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { AxisId, NamedInstanceId } from "@shift/types";
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
  X,
  cn,
} from "@shift/ui";
import PlusIcon from "@/assets/general/plus.svg";
import WarningIcon from "@/assets/general/warning.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useAxes } from "@/hooks/useAxes";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { useFont } from "@/workspace/WorkspaceContext";
import { instanceCreationIssue, instanceLocation, suggestedInstanceName } from "./instanceCreation";

interface CreateInstanceMenuProps {
  onInstanceCreated?: (instanceId: NamedInstanceId) => void;
  onOpenChange?: (open: boolean) => void;
}

interface CreateInstanceFormValues {
  name: string;
  location: Record<string, string>;
}

const emptyValues: CreateInstanceFormValues = {
  name: "",
  location: {},
};
const INSTANCE_CREATION_ERROR_ID = "create-instance-error";

export const CreateInstanceMenu = ({
  onInstanceCreated,
  onOpenChange,
}: CreateInstanceMenuProps) => {
  const font = useFont();
  const axes = useAxes().filter((axis) => axis.role === "external");
  const instances = useNamedInstances();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CreateInstanceFormValues>(emptyValues);
  const [validationVisible, setValidationVisible] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const axisInputRefs = useRef(new Map<AxisId, HTMLInputElement>());

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setValues({
        name: suggestedInstanceName(instances),
        location: Object.fromEntries(axes.map((axis) => [axis.id, String(axis.default)])),
      });
    }
    setValidationVisible(false);
    setOpen(nextOpen);
    if (onOpenChange) onOpenChange(nextOpen);
  };

  const updateName = (event: ChangeEvent<HTMLInputElement>) => {
    const name = event.currentTarget.value;
    setValues((current) => ({ ...current, name }));
  };

  const updateAxisValue = (axisId: AxisId) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setValues((current) => ({
      ...current,
      location: { ...current.location, [axisId]: value },
    }));
  };

  const issue = instanceCreationIssue(values.name, values.location, axes, instances);
  const visibleIssue = validationVisible ? issue : null;
  const nameIssue = visibleIssue && visibleIssue.kind === "name" ? visibleIssue : null;
  const locationIssue = visibleIssue && visibleIssue.kind === "location" ? visibleIssue : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issue) {
      setValidationVisible(true);

      switch (issue.kind) {
        case "name":
          nameInputRef.current?.focus();
          return;
        case "axis":
          axisInputRefs.current.get(issue.axisId)?.focus();
          return;
        case "location": {
          const firstAxis = axes[0];
          if (firstAxis) axisInputRefs.current.get(firstAxis.id)?.focus();
          return;
        }
      }
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

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger
        render={
          <SidebarActionButton
            label={axes.length > 0 ? "Create instance" : "Add an axis before creating instances"}
            disabled={axes.length === 0}
          >
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        }
      />
      <PopoverPortal>
        <PopoverPositioner sideOffset={4} align="start">
          <PopoverPopup className="w-50 p-0" initialFocus={nameInputRef}>
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle className="text-ui font-medium text-primary">
                Create Instance
              </PopoverTitle>
              <PopoverClose
                className={cn(
                  "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded",
                  "text-primary/70 transition-colors hover:bg-hover hover:text-primary",
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </PopoverClose>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 px-2 py-1">
                <Field className="contents" invalid={!!nameIssue}>
                  <FieldLabel htmlFor="create-instance-name" className="text-ui text-primary">
                    Name
                  </FieldLabel>
                  <FieldControl
                    ref={nameInputRef}
                    id="create-instance-name"
                    value={values.name}
                    onChange={updateName}
                    aria-describedby={nameIssue ? INSTANCE_CREATION_ERROR_ID : undefined}
                    className="h-7 min-w-0 max-w-full bg-white px-2 text-right text-ui text-black"
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
                      className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 rounded ring-1 ring-inset ring-red-500"
                      aria-hidden="true"
                    />
                  )}

                  {axes.map((axis) => {
                    const axisIssue =
                      visibleIssue &&
                      visibleIssue.kind === "axis" &&
                      visibleIssue.axisId === axis.id
                        ? visibleIssue
                        : null;

                    return (
                      <Field key={axis.id} className="contents" invalid={!!axisIssue}>
                        <FieldLabel
                          htmlFor={`create-instance-${axis.id}`}
                          className="min-w-0 truncate text-ui text-primary"
                          title={axis.name}
                        >
                          {axis.name}
                        </FieldLabel>
                        <FieldControl
                          ref={(input) => {
                            if (input) {
                              axisInputRefs.current.set(axis.id, input);
                              return;
                            }

                            axisInputRefs.current.delete(axis.id);
                          }}
                          id={`create-instance-${axis.id}`}
                          value={values.location[axis.id] ?? ""}
                          onChange={updateAxisValue(axis.id)}
                          aria-describedby={axisIssue ? INSTANCE_CREATION_ERROR_ID : undefined}
                          className="h-7 min-w-0 max-w-full bg-white px-2 text-right text-ui text-black"
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
                  className="flex items-start gap-1.5 px-2 pb-1.5 text-ui text-red-600"
                >
                  <WarningIcon
                    className="mt-0.5 h-3 w-3 shrink-0 text-red-600"
                    aria-hidden="true"
                  />
                  <span>{visibleIssue.message}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 px-2 pb-2 pt-1.5">
                <PopoverClose
                  render={
                    <Button type="button" className="h-[30px] text-ui">
                      Cancel
                    </Button>
                  }
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="h-[30px] text-ui"
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
