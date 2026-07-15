import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
import type { Axis, AxisId, Source, SourceId } from "@shift/types";
import PlusIcon from "@/assets/general/plus.svg";
import WarningIcon from "@/assets/general/warning.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useAxes } from "@/hooks/useAxes";
import { useDesignLocation } from "@/hooks/useDesignLocation";
import { useSources } from "@/hooks/useSources";
import { axisValue } from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { useEditor } from "@/workspace/WorkspaceContext";
import { sourceCreationIssue, sourceLocation, suggestedSourceName } from "./sourceCreation";

interface CreateSourceMenuProps {
  onSourceCreated?: (sourceId: SourceId) => void;
  onOpenChange?: (open: boolean) => void;
}

interface CreateSourceFormValues {
  name: string;
  location: Record<string, string>;
}

const emptyValues: CreateSourceFormValues = {
  name: "",
  location: {},
};
const SOURCE_CREATION_ERROR_ID = "create-source-error";

function defaultValues(
  axes: readonly Axis[],
  sources: readonly Source[],
  designLocation: AxisLocation,
): CreateSourceFormValues {
  return {
    name: suggestedSourceName(axes, sources, designLocation),
    location: Object.fromEntries(
      axes.map((axis) => [axis.id, String(axisValue(designLocation, axis))]),
    ),
  };
}

export const CreateSourceMenu = ({ onSourceCreated, onOpenChange }: CreateSourceMenuProps) => {
  const editor = useEditor();
  const axes = useAxes();
  const sources = useSources();
  const [designLocation] = useDesignLocation();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CreateSourceFormValues>(emptyValues);
  const [validationVisible, setValidationVisible] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const axisInputRefs = useRef(new Map<AxisId, HTMLInputElement>());

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setValues(defaultValues(axes, sources, designLocation));
    setValidationVisible(false);
    setOpen(nextOpen);
    if (onOpenChange) onOpenChange(nextOpen);
  };

  const updateName = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setValues((current) => ({ ...current, name: value }));
  };

  const updateAxisValue = (axisId: AxisId) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setValues((current) => ({
      ...current,
      location: { ...current.location, [axisId]: value },
    }));
  };

  const trimmedName = values.name.trim();
  const location = sourceLocation(axes, values.location);
  const issue = sourceCreationIssue(values.name, values.location, axes, sources);
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
    if (!location) return;

    const sourceId = editor.createSource(trimmedName, location);
    if (onSourceCreated) onSourceCreated(sourceId);
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger
        render={
          <SidebarActionButton label="Create source">
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        }
      />
      <PopoverPortal>
        <PopoverPositioner sideOffset={4} align="start">
          <PopoverPopup className="w-50 p-0" initialFocus={nameInputRef}>
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle className="text-ui font-medium text-primary">
                Create Source
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
                  <FieldLabel htmlFor="create-source-name" className="text-ui text-primary">
                    Name
                  </FieldLabel>
                  <FieldControl
                    ref={nameInputRef}
                    id="create-source-name"
                    value={values.name}
                    onChange={updateName}
                    aria-describedby={nameIssue ? SOURCE_CREATION_ERROR_ID : undefined}
                    className="h-7 min-w-0 max-w-full bg-white px-2 text-right text-ui text-black"
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
                          htmlFor={`create-source-${axis.id}`}
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
                          id={`create-source-${axis.id}`}
                          value={values.location[axis.id] ?? ""}
                          onChange={updateAxisValue(axis.id)}
                          aria-describedby={axisIssue ? SOURCE_CREATION_ERROR_ID : undefined}
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
                  id={SOURCE_CREATION_ERROR_ID}
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
