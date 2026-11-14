import type { WorkspaceExportFormat } from "@shared/workspace/lanes";

/**
 * A target in the Export dialog: a variable font binary, one static binary
 * per named instance, or editable sources (a designspace with one UFO per
 * master).
 */
export type ExportTarget = (typeof EXPORT_TARGETS)[number];

/** Every Export dialog target, in sidebar order. */
export const EXPORT_TARGETS = ["variable", "static", "ufo"] as const;

/** The workspace export format each target writes. */
export const exportFormatFor = {
  variable: "ttf",
  static: "static-ttf",
  ufo: "designspace",
} as const satisfies Record<ExportTarget, WorkspaceExportFormat>;
