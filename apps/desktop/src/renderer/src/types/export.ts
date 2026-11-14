import type { WorkspaceBinaryEncoding, WorkspaceExportFormat } from "@shared/workspace/lanes";

/**
 * A target in the Export dialog: a variable font binary, one static binary
 * per named instance, or editable sources (a designspace with one UFO per
 * master).
 */
export type ExportTarget = (typeof EXPORT_TARGETS)[number];

/** Every Export dialog target, in sidebar order. */
export const EXPORT_TARGETS = ["variable", "static", "ufo"] as const;

/** The binary encodings the dialog offers, in the order it lists them. */
export const BINARY_ENCODINGS = [
  "ttf",
  "woff2",
] as const satisfies readonly WorkspaceBinaryEncoding[];

/** Whether `target` writes compiled binaries, whose encodings can be chosen. */
export function writesBinaries(target: ExportTarget): boolean {
  return target !== "ufo";
}

/** The workspace export format each target writes. */
export const exportFormatFor = {
  variable: "ttf",
  static: "static-ttf",
  ufo: "designspace",
} as const satisfies Record<ExportTarget, WorkspaceExportFormat>;
