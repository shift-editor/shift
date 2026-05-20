import { useState } from "react";
import { X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  cn,
} from "@shift/ui";
import { getEditor } from "@/store/store";

interface FontInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId = "general" | "font" | "sources" | "features" | "shortcuts";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "font", label: "Font" },
  { id: "sources", label: "Sources" },
  { id: "features", label: "Features" },
  { id: "shortcuts", label: "Shortcuts" },
];

export const FontInfoDialog = ({ open, onOpenChange }: FontInfoDialogProps) => {
  const editor = getEditor();
  const [category, setCategory] = useState<CategoryId>("font");

  if (!editor.font.loaded) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed inset-8 left-8 top-8 max-w-none translate-x-0 translate-y-0 max-w-[1200px] max-h-[800px] m-auto",
            "grid grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-lg border border-line-subtle",
            "shadow-lg",
          )}
        >
          <DialogTitle className="sr-only">Font information</DialogTitle>

          <nav className="flex flex-col gap-1 items-start bg-white p-2">
            {CATEGORIES.map((c) => (
              <Button
                key={c.id}
                variant="ghost"
                onClick={() => setCategory(c.id)}
                className={cn(
                  "w-full justify-start p-0 pl-2",
                  category === c.id ? "font-medium text-primary" : "text-primary hover:bg-hover",
                )}
              >
                {c.label}
              </Button>
            ))}
          </nav>

          <section className="relative bg-canvas p-6 overflow-auto">
            <DialogClose
              className={cn(
                "absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center cursor-pointer",
                "rounded text-primary/70 hover:text-primary hover:bg-hover transition-colors",
              )}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogClose>

            <CategoryPanel category={category} />
          </section>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

const CategoryPanel = ({ category }: { category: CategoryId }) => {
  switch (category) {
    case "font":
      return <FontPanel />;
    case "general":
    case "sources":
    case "features":
    case "shortcuts":
      return <PlaceholderPanel label={CATEGORIES.find((c) => c.id === category)!.label} />;
  }
};

const FontPanel = () => {
  const editor = getEditor();
  const m = editor.font.metadata;
  const version = m.versionMajor !== undefined ? `${m.versionMajor}.${m.versionMinor ?? 0}` : "";

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-medium text-primary">Font</h2>
      <FieldGrid
        fields={[
          { label: "Name", text: m.familyName ?? "" },
          { label: "Version", text: version },
          { label: "Copyright", text: m.copyright ?? "" },
          { label: "Trademark", text: m.trademark ?? "" },
          { label: "Sample text", text: m.description ?? "" },
          { label: "Designer", text: m.designer ?? "" },
          { label: "Design URL", text: m.designerUrl ?? "" },
        ]}
      />
    </div>
  );
};

interface Field {
  label: string;
  text: string;
}

const FieldGrid = ({ fields }: { fields: Field[] }) => (
  <div className="grid grid-cols-[120px_minmax(0,320px)] gap-x-4 gap-y-3 items-center">
    {fields.map((f) => (
      <FieldRow key={f.label} field={f} />
    ))}
  </div>
);

const FieldRow = ({ field }: { field: Field }) => (
  <>
    <label className="text-sm text-primary">{field.label}</label>
    <Input defaultValue={field.text} readOnly className="h-7 text-sm bg-white" />
  </>
);

const PlaceholderPanel = ({ label }: { label: string }) => (
  <div className="flex flex-col gap-2">
    <h2 className="text-sm font-medium text-primary">{label}</h2>
    <p className="text-sm text-secondary">Coming soon.</p>
  </div>
);
