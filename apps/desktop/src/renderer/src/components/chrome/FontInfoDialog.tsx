import { useEffect, useState, type KeyboardEvent } from "react";
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
import { getEditor, getWorkingCopy } from "@/store/store";
import { useSignalState } from "@/lib/signals";
import type { FontMetadata } from "@shift/types";

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
  const metadata = useSignalState(editor.font.$metadata);
  const [draft, setDraft] = useState(() => metadataDraft(metadata));

  useEffect(() => {
    setDraft(metadataDraft(metadata));
  }, [metadata]);

  const updateDraft = (field: MetadataFieldId, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const commitTextField = (field: TextMetadataField, value: string) => {
    getWorkingCopy().commitMutation(() => {
      editor.font.updateMetadata({ [field]: value });
    });
  };

  const commitVersion = (value: string) => {
    const version = parseVersion(value);
    if (!version) {
      setDraft((current) => ({ ...current, version: versionText(metadata) }));
      return;
    }

    getWorkingCopy().commitMutation(() => {
      editor.font.updateMetadata(version);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-medium text-primary">Font</h2>
      <div className="grid grid-cols-[120px_minmax(0,320px)] gap-x-4 gap-y-3 items-center">
        {TEXT_FIELDS.map((field) => (
          <FieldRow
            key={field.id}
            label={field.label}
            value={draft[field.id]}
            onChange={(value) => updateDraft(field.id, value)}
            onCommit={(value) => commitTextField(field.id, value)}
          />
        ))}
        <FieldRow
          label="Version"
          value={draft.version}
          onChange={(value) => updateDraft("version", value)}
          onCommit={commitVersion}
        />
      </div>
    </div>
  );
};

type TextMetadataField =
  | "familyName"
  | "styleName"
  | "copyright"
  | "trademark"
  | "description"
  | "designer"
  | "designerUrl";

type MetadataFieldId = TextMetadataField | "version";

interface TextField {
  id: TextMetadataField;
  label: string;
}

const TEXT_FIELDS: readonly TextField[] = [
  { id: "familyName", label: "Family name" },
  { id: "styleName", label: "Style name" },
  { id: "copyright", label: "Copyright" },
  { id: "trademark", label: "Trademark" },
  { id: "description", label: "Sample text" },
  { id: "designer", label: "Designer" },
  { id: "designerUrl", label: "Design URL" },
];

type MetadataDraft = Record<MetadataFieldId, string>;

function metadataDraft(metadata: FontMetadata): MetadataDraft {
  return {
    familyName: metadata.familyName ?? "",
    styleName: metadata.styleName ?? "",
    copyright: metadata.copyright ?? "",
    trademark: metadata.trademark ?? "",
    description: metadata.description ?? "",
    designer: metadata.designer ?? "",
    designerUrl: metadata.designerUrl ?? "",
    version: versionText(metadata),
  };
}

function versionText(metadata: FontMetadata): string {
  return metadata.versionMajor === undefined
    ? ""
    : `${metadata.versionMajor}.${metadata.versionMinor ?? 0}`;
}

function parseVersion(value: string): Pick<FontMetadata, "versionMajor" | "versionMinor"> | null {
  const trimmed = value.trim();
  if (!trimmed) return { versionMajor: undefined, versionMinor: undefined };

  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  return {
    versionMajor: Number.parseInt(match[1], 10),
    versionMinor: match[2] ? Number.parseInt(match[2], 10) : 0,
  };
}

interface FieldRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}

const FieldRow = ({ label, value, onChange, onCommit }: FieldRowProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <>
      <label className="text-sm text-primary">{label}</label>
      <Input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={(event) => onCommit(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        className="h-7 text-sm bg-white"
      />
    </>
  );
};

const PlaceholderPanel = ({ label }: { label: string }) => (
  <div className="flex flex-col gap-2">
    <h2 className="text-sm font-medium text-primary">{label}</h2>
    <p className="text-sm text-secondary">Coming soon.</p>
  </div>
);
