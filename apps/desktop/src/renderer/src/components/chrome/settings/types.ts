import type { Axis, FontMetadata } from "@shift/types";
import type { FieldValues, UseFormReturn } from "react-hook-form";

export type TextMetadataKey = {
  [Key in keyof FontMetadata]-?: FontMetadata[Key] extends string | undefined ? Key : never;
}[keyof FontMetadata];

export type NumberMetadataKey = {
  [Key in keyof FontMetadata]-?: FontMetadata[Key] extends number | undefined ? Key : never;
}[keyof FontMetadata];

export type AxisTransform = (axis: Axis) => Axis;

export interface SettingsFormOptions<T extends FieldValues> {
  canonical: T;
  save: (value: T) => Promise<T>;
  errorMessage: string;
}

export interface SettingsForm<T extends FieldValues> {
  draft: T;
  error: string | null;
  form: UseFormReturn<T>;
  update: (transform: (value: T) => T) => T;
  commit: (candidate?: T) => Promise<void>;
  updateAndCommit: (transform: (value: T) => T) => Promise<void>;
}

/** Local axis replacement draft shared by the Definition and Styles tabs. */
export interface AxisDraft {
  axis: Axis;
  error: string | null;
  update: (transform: AxisTransform) => Axis;
  commit: (candidate?: Axis) => Promise<void>;
  updateAndCommit: (transform: AxisTransform) => Promise<void>;
}
