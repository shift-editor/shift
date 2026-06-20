import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  X,
  cn,
} from "@shift/ui";
import type { Axis, AxisId, Source } from "@shift/types";
import { useAxes } from "@/hooks/useAxes";
import { useSources } from "@/hooks/useSources";
import { getEditor } from "@/store/appStore";

interface CreateSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateSourceFormValues {
  name: string;
  location: Record<string, string>;
}

const emptyValues: CreateSourceFormValues = {
  name: "",
  location: {},
};

function defaultSourceName(sources: readonly Source[]): string {
  if (!sources.some((source) => source.name === "Bold")) return "Bold";

  let index = sources.length + 1;
  let name = `Source ${index}`;
  while (sources.some((source) => source.name === name)) {
    index += 1;
    name = `Source ${index}`;
  }
  return name;
}

function defaultValues(axes: readonly Axis[], sources: readonly Source[]): CreateSourceFormValues {
  return {
    name: defaultSourceName(sources),
    location: Object.fromEntries(axes.map((axis) => [axis.id, String(axis.maximum)])),
  };
}

export const CreateSourceDialog = ({ open, onOpenChange }: CreateSourceDialogProps) => {
  const editor = getEditor();
  const axes = useAxes();
  const sources = useSources();
  const [values, setValues] = useState<CreateSourceFormValues>(emptyValues);

  useEffect(() => {
    if (open) setValues(defaultValues(axes, sources));
  }, [open, axes, sources]);

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const location = {
      values: Object.fromEntries(
        axes.map((axis) => [axis.id, Number(values.location[axis.id])]),
      ) as Record<AxisId, number>,
    };
    editor.font.createSource(trimmedName, location);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line-subtle bg-canvas p-5 shadow-lg",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <DialogTitle className="text-sm font-medium text-primary">Create source</DialogTitle>
            <DialogClose
              className={cn(
                "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded",
                "text-primary/70 transition-colors hover:bg-hover hover:text-primary",
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogClose>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <label className="text-ui text-secondary">Name</label>
              <Input value={values.name} onChange={updateName} className="h-7 text-sm bg-white" />

              {axes.map((axis) => (
                <div key={axis.id} className="contents">
                  <label className="min-w-0 truncate text-ui text-secondary" title={axis.name}>
                    {axis.name}
                  </label>
                  <Input
                    value={values.location[axis.id] ?? ""}
                    onChange={updateAxisValue(axis.id)}
                    className="h-7 text-sm bg-white"
                    inputMode="decimal"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <DialogClose
                render={
                  <Button type="button" variant="ghost" size="sm">
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" size="sm">
                Create
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};
