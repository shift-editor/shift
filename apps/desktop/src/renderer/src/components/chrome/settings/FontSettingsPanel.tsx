import type { ChangeEvent, ReactNode } from "react";
import type { FontMetadata } from "@shift/types";
import { Field, FieldLabel, Input, Textarea } from "@shift/ui";
import { message } from "@shared/messages";
import { useSignalState } from "@shift/editor/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { SettingsNumberField } from "./SettingsNumberField";
import type { NumberMetadataKey, TextMetadataKey } from "./types";
import { useSettingsForm } from "./useSettingsForm";

export const FontSettingsPanel = ({ canAuthor }: { canAuthor: boolean }) => {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const form = useSettingsForm<FontMetadata>({
    canonical: metadata,
    errorMessage: message("settings.fontSaveFailed"),
    save: async (next) => {
      await font.updateMetadata(next);
      return font.metadata;
    },
  });
  const draft = form.draft;
  const commit = async (): Promise<void> => {
    await form.commit();
  };

  const updateText =
    (field: TextMetadataKey) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      form.update((current) => ({
        ...current,
        [field]: value === "" ? undefined : value,
      }));
    };

  const updateNumber = (field: NumberMetadataKey, value: number | null) => {
    form.update((current) => ({ ...current, [field]: value ?? undefined }));
  };

  return (
    <fieldset disabled={!canAuthor} className="flex min-w-0 flex-col gap-4 p-5 pr-8">
      <h2 className="text-sm font-medium text-primary">Font</h2>
      {form.error && <p className="text-xs text-error">{form.error}</p>}

      <MetadataField label="Family Name">
        <Input
          value={draft.familyName ?? ""}
          onChange={updateText("familyName")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Style Name">
        <Input
          value={draft.styleName ?? ""}
          onChange={updateText("styleName")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <div className="grid grid-cols-2 gap-3">
        <MetadataField label="Version Major">
          <SettingsNumberField
            value={draft.versionMajor ?? null}
            onValueChange={(value) => updateNumber("versionMajor", value)}
            onValueCommitted={commit}
            ariaLabel="Version major"
          />
        </MetadataField>
        <MetadataField label="Version Minor">
          <SettingsNumberField
            value={draft.versionMinor ?? null}
            onValueChange={(value) => updateNumber("versionMinor", value)}
            onValueCommitted={commit}
            ariaLabel="Version minor"
          />
        </MetadataField>
      </div>

      <MetadataField label="Copyright">
        <Input
          value={draft.copyright ?? ""}
          onChange={updateText("copyright")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Trademark">
        <Input
          value={draft.trademark ?? ""}
          onChange={updateText("trademark")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="License Description">
        <Textarea
          value={draft.license ?? ""}
          onChange={updateText("license")}
          onBlur={commit}
          variant="plain"
          className="min-h-24"
        />
      </MetadataField>

      <MetadataField label="Manufacturer">
        <Input
          value={draft.manufacturer ?? ""}
          onChange={updateText("manufacturer")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="License Information URL">
        <Input
          value={draft.licenseUrl ?? ""}
          onChange={updateText("licenseUrl")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Designer">
        <Input
          value={draft.designer ?? ""}
          onChange={updateText("designer")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Designer URL">
        <Input
          value={draft.designerUrl ?? ""}
          onChange={updateText("designerUrl")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Manufacturer URL">
        <Input
          value={draft.manufacturerUrl ?? ""}
          onChange={updateText("manufacturerUrl")}
          onBlur={commit}
          size="md"
          variant="plain"
        />
      </MetadataField>

      <MetadataField label="Description">
        <Textarea
          value={draft.description ?? ""}
          onChange={updateText("description")}
          onBlur={commit}
          variant="plain"
          className="min-h-20"
        />
      </MetadataField>

      <MetadataField label="Note">
        <Textarea
          value={draft.note ?? ""}
          onChange={updateText("note")}
          onBlur={commit}
          variant="plain"
          className="min-h-20"
        />
      </MetadataField>
    </fieldset>
  );
};

const MetadataField = ({ label, children }: { label: string; children: ReactNode }) => (
  <Field className="gap-1.5">
    <FieldLabel tone="primary" className="text-sm">
      {label}
    </FieldLabel>
    {children}
  </Field>
);
