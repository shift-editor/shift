import type { Axis, FontMetadata } from "@shift/types";

export type SettingsCategory = "font" | "sources" | "axes" | "features";

export type AxisSettingsSection = "definition" | "mapping" | "styles";

export type TextMetadataKey = {
  [Key in keyof FontMetadata]-?: FontMetadata[Key] extends string | undefined ? Key : never;
}[keyof FontMetadata];

export type NumberMetadataKey = {
  [Key in keyof FontMetadata]-?: FontMetadata[Key] extends number | undefined ? Key : never;
}[keyof FontMetadata];

export type AxisTransform = (axis: Axis) => Axis;

/** Local axis replacement draft shared by the Definition and Styles tabs. */
export interface AxisDraft {
  axis: Axis;
  error: string | null;
  update: (transform: AxisTransform) => Axis;
  commit: (candidate?: Axis) => Promise<void>;
  updateAndCommit: (transform: AxisTransform) => Promise<void>;
}
