import { useEffect, useState } from "react";
import { getEditor, getWorkingCopy } from "@/store/store";
import { useSignalState } from "@/lib/signals";
import type { FontMetadata, FontMetrics } from "@shift/types";
import { InfoField } from "./InfoField";
import { parseVersion, versionText } from "./version";

export const FontMetadataPanel = () => {
  const editor = getEditor();
  const metadata = useSignalState(editor.font.metadataCell);
  const metrics = useSignalState(editor.font.metricsCell);
  const [draft, setDraft] = useState(() => metadataDraft(metadata, metrics));

  useEffect(() => {
    setDraft(metadataDraft(metadata, metrics));
  }, [metadata, metrics]);

  const updateDraft = (field: DraftFieldId, value: string) => {
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
      updateDraft("version", versionText(metadata));
      return;
    }

    getWorkingCopy().commitMutation(() => {
      editor.font.updateMetadata(version);
    });
  };

  const commitUnitsPerEm = (value: string) => {
    const unitsPerEm = Number.parseFloat(value);
    if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) {
      updateDraft("unitsPerEm", String(metrics.unitsPerEm));
      return;
    }

    getWorkingCopy().commitMutation(() => {
      editor.font.updateMetrics({ ...metrics, unitsPerEm });
    });
  };

  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
      {SUPPORTED_FIELDS.map((field) =>
        field.id === "version" ? (
          <InfoField
            key={field.id}
            label={field.label}
            value={draft.version}
            onChange={(value) => updateDraft("version", value)}
            onCommit={commitVersion}
          />
        ) : field.id === "unitsPerEm" ? (
          <InfoField
            key={field.id}
            label={field.label}
            value={draft.unitsPerEm}
            onChange={(value) => updateDraft("unitsPerEm", value)}
            onCommit={commitUnitsPerEm}
            type="number"
          />
        ) : (
          <InfoField
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
type MetricsFieldId = "unitsPerEm";
type DraftFieldId = MetadataFieldId | MetricsFieldId;

interface TextField {
  id: TextMetadataField;
  label: string;
  multiline?: boolean;
}

type Field = TextField | { id: "version"; label: string } | { id: "unitsPerEm"; label: string };

const SUPPORTED_FIELDS: readonly Field[] = [
  { id: "familyName", label: "Family name" },
  { id: "styleName", label: "Style name" },
  { id: "version", label: "Version" },
  { id: "unitsPerEm", label: "Units per em" },
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

type MetadataDraft = Record<DraftFieldId, string>;

function metadataDraft(metadata: FontMetadata, metrics: FontMetrics): MetadataDraft {
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
    unitsPerEm: String(metrics.unitsPerEm),
  };
}
