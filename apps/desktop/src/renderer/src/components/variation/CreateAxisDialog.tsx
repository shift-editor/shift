import { useState, type ChangeEvent, type FormEvent } from "react";
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
import { useFont } from "@/workspace/WorkspaceContext";

interface CreateAxisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateAxisFormValues {
  tag: string;
  name: string;
  min: string;
  default: string;
  max: string;
  hidden: boolean;
}

const DEFAULT_AXIS_VALUES: CreateAxisFormValues = {
  tag: "wght",
  name: "Weight",
  min: "100",
  default: "400",
  max: "900",
  hidden: false,
};

export const CreateAxisDialog = ({ open, onOpenChange }: CreateAxisDialogProps) => {
  const font = useFont();
  const [values, setValues] = useState<CreateAxisFormValues>(DEFAULT_AXIS_VALUES);

  const updateValue =
    (field: keyof CreateAxisFormValues) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      setValues((current) => ({ ...current, [field]: value }));
    };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    font.createAxis({
      name: values.name,
      tag: values.tag,
      role: "external",
      axisType: "continuous",
      minimum: Number(values.min),
      default: Number(values.default),
      maximum: Number(values.max),
      labels: [],
      hidden: values.hidden,
    });
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
            <DialogTitle className="text-sm font-medium text-primary">Create axis</DialogTitle>
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
              <label className="text-ui text-secondary">Tag</label>
              <Input
                value={values.tag}
                onChange={updateValue("tag")}
                className="h-7 text-sm bg-white"
              />

              <label className="text-ui text-secondary">Name</label>
              <Input
                value={values.name}
                onChange={updateValue("name")}
                className="h-7 text-sm bg-white"
              />

              <label className="text-ui text-secondary">Minimum</label>
              <Input
                value={values.min}
                onChange={updateValue("min")}
                className="h-7 text-sm bg-white"
                inputMode="numeric"
              />

              <label className="text-ui text-secondary">Default</label>
              <Input
                value={values.default}
                onChange={updateValue("default")}
                className="h-7 text-sm bg-white"
                inputMode="numeric"
              />

              <label className="text-ui text-secondary">Maximum</label>
              <Input
                value={values.max}
                onChange={updateValue("max")}
                className="h-7 text-sm bg-white"
                inputMode="numeric"
              />
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
