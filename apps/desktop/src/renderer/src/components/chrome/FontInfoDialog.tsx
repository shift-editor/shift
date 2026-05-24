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

export const FontInfoDialog = ({ open, onOpenChange }: FontInfoDialogProps) => {
  const editor = getEditor();

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
          <nav className="flex flex-col gap-1 items-start bg-white p-2">
            <Button
              variant="ghost"
              className="w-full justify-start p-0 pl-2 font-medium text-primary"
            >
              Font information
            </Button>
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

            <DialogTitle className="mb-6 text-sm font-medium text-primary">
              Font information
            </DialogTitle>
            <FontPanel />
          </section>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

const FontPanel = () => {
  const editor = getEditor();
  const metadata = useSignalState(editor.font.metadataCell);
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
    <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
      {SUPPORTED_FIELDS.map((field) =>
        field.id === "version" ? (
          <FieldRow
            key={field.id}
            label={field.label}
            value={draft.version}
            onChange={(value) => updateDraft("version", value)}
            onCommit={commitVersion}
          />
        ) : (
          <FieldRow
            key={field.id}
            label={field.label}
            value={draft[field.id]}
            onChange={(value) => updateDraft(field.id, value)}
            onCommit={(value) => commitTextField(field.id, value)}
            multiline={field.multiline}
          />
        ),
      )}
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
  | "designerUrl"
  | "manufacturer"
  | "manufacturerUrl"
  | "license"
  | "licenseUrl"
  | "note";

type MetadataFieldId = TextMetadataField | "version";

interface TextField {
  id: TextMetadataField;
  label: string;
  multiline?: boolean;
}

type Field = TextField | { id: "version"; label: string };

const SUPPORTED_FIELDS: readonly Field[] = [
  { id: "familyName", label: "Family name" },
  { id: "styleName", label: "Style name" },
  { id: "version", label: "Version" },
  { id: "copyright", label: "Copyright" },
  { id: "trademark", label: "Trademark" },
  { id: "designer", label: "Designer" },
  { id: "designerUrl", label: "Design URL" },
  { id: "manufacturer", label: "Manufacturer" },
  { id: "manufacturerUrl", label: "Manufacturer URL" },
  { id: "license", label: "License" },
  { id: "licenseUrl", label: "License URL" },
  { id: "description", label: "Description", multiline: true },
  { id: "note", label: "Note", multiline: true },
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
    manufacturer: metadata.manufacturer ?? "",
    manufacturerUrl: metadata.manufacturerUrl ?? "",
    license: metadata.license ?? "",
    licenseUrl: metadata.licenseUrl ?? "",
    note: metadata.note ?? "",
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
  multiline?: boolean;
}

const FieldRow = ({ label, value, onChange, onCommit, multiline = false }: FieldRowProps) => {
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && event.metaKey) {
      event.currentTarget.blur();
    }
  };

  return (
    <>
      <label className="text-sm text-primary self-start pt-1.5">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyDown={handleTextareaKeyDown}
          rows={3}
          className={cn(
            "w-full resize-none rounded bg-white px-2 py-1 text-sm text-primary",
            "focus:outline-none focus:ring-1 focus:ring-accent",
          )}
        />
      ) : (
        <Input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          className="h-7 text-sm bg-white"
        />
      )}
    </>
  );
};
