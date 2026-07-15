import type { ChangeEvent, ReactNode } from "react";
import type { FontMetadata } from "@shift/types";
import { Field, FieldLabel, Input, Textarea } from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { SettingsNumberField } from "./SettingsNumberField";
import type { NumberMetadataKey, TextMetadataKey } from "./types";
import { useSettingsForm } from "./useSettingsForm";

export const FontSettingsPanel = () => {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const form = useSettingsForm<FontMetadata>({
    canonical: metadata,
    errorMessage: "Unable to update font metadata",
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
    <section className="flex min-w-0 flex-col gap-4 p-5 pr-8">
      <h2 className="text-sm font-medium text-primary">Font</h2>
      {form.error && <p className="text-xs text-red-600">{form.error}</p>}

      <MetadataField label="Family Name">
        <Input
          value={draft.familyName ?? ""}
          onChange={updateText("familyName")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Style Name">
        <Input
          value={draft.styleName ?? ""}
          onChange={updateText("styleName")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
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
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Trademark">
        <Input
          value={draft.trademark ?? ""}
          onChange={updateText("trademark")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="License Description">
        <Textarea
          value={draft.license ?? ""}
          onChange={updateText("license")}
          onBlur={commit}
          className="min-h-24 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Manufacturer">
        <Input
          value={draft.manufacturer ?? ""}
          onChange={updateText("manufacturer")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="License Information URL">
        <Input
          value={draft.licenseUrl ?? ""}
          onChange={updateText("licenseUrl")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Designer">
        <Input
          value={draft.designer ?? ""}
          onChange={updateText("designer")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Designer URL">
        <Input
          value={draft.designerUrl ?? ""}
          onChange={updateText("designerUrl")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Manufacturer URL">
        <Input
          value={draft.manufacturerUrl ?? ""}
          onChange={updateText("manufacturerUrl")}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Description">
        <Textarea
          value={draft.description ?? ""}
          onChange={updateText("description")}
          onBlur={commit}
          className="min-h-20 bg-white text-sm text-black"
        />
      </MetadataField>

      <MetadataField label="Note">
        <Textarea
          value={draft.note ?? ""}
          onChange={updateText("note")}
          onBlur={commit}
          className="min-h-20 bg-white text-sm text-black"
        />
      </MetadataField>
    </section>
  );
};

const MetadataField = ({ label, children }: { label: string; children: ReactNode }) => (
  <Field className="gap-1.5">
    <FieldLabel className="text-sm text-primary">{label}</FieldLabel>
    {children}
  </Field>
);
