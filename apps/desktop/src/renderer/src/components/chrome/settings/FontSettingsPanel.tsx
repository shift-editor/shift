import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { FontMetadata } from "@shift/types";
import { Field, FieldLabel, Input, Textarea } from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { SettingsNumberField } from "./SettingsNumberField";
import type { NumberMetadataKey, TextMetadataKey } from "./types";

export const FontSettingsPanel = () => {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const [draft, setDraft] = useState(metadata);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(metadata);
  const pendingRef = useRef(0);

  useEffect(() => {
    if (pendingRef.current > 0) return;

    draftRef.current = metadata;
    setDraft(metadata);
    setError(null);
  }, [metadata]);

  const replaceDraft = useCallback((next: FontMetadata) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const updateText =
    (field: TextMetadataKey) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      replaceDraft({ ...draftRef.current, [field]: value === "" ? undefined : value });
    };

  const updateNumber = (field: NumberMetadataKey, value: number | null) => {
    replaceDraft({ ...draftRef.current, [field]: value ?? undefined });
  };

  const commit = useCallback(async (): Promise<void> => {
    pendingRef.current += 1;
    setError(null);

    try {
      await font.updateMetadata(draftRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update font metadata");
    } finally {
      pendingRef.current -= 1;
    }
  }, [font]);

  return (
    <section className="flex min-w-0 flex-col gap-4 p-5 pr-8">
      <h2 className="text-sm font-medium text-primary">Font</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <MetadataField label="Family Name">
        <Input
          value={draft.familyName ?? ""}
          onChange={updateText("familyName")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Style Name">
        <Input
          value={draft.styleName ?? ""}
          onChange={updateText("styleName")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
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
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Trademark">
        <Input
          value={draft.trademark ?? ""}
          onChange={updateText("trademark")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="License Description">
        <Textarea
          value={draft.license ?? ""}
          onChange={updateText("license")}
          onBlur={commit}
          className="min-h-24 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Manufacturer">
        <Input
          value={draft.manufacturer ?? ""}
          onChange={updateText("manufacturer")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="License Information URL">
        <Input
          value={draft.licenseUrl ?? ""}
          onChange={updateText("licenseUrl")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Designer">
        <Input
          value={draft.designer ?? ""}
          onChange={updateText("designer")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Designer URL">
        <Input
          value={draft.designerUrl ?? ""}
          onChange={updateText("designerUrl")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Manufacturer URL">
        <Input
          value={draft.manufacturerUrl ?? ""}
          onChange={updateText("manufacturerUrl")}
          onBlur={commit}
          className="h-8 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Description">
        <Textarea
          value={draft.description ?? ""}
          onChange={updateText("description")}
          onBlur={commit}
          className="min-h-20 bg-white text-xs"
        />
      </MetadataField>

      <MetadataField label="Note">
        <Textarea
          value={draft.note ?? ""}
          onChange={updateText("note")}
          onBlur={commit}
          className="min-h-20 bg-white text-xs"
        />
      </MetadataField>
    </section>
  );
};

const MetadataField = ({ label, children }: { label: string; children: ReactNode }) => (
  <Field className="gap-1.5">
    <FieldLabel className="text-xs text-primary">{label}</FieldLabel>
    {children}
  </Field>
);
