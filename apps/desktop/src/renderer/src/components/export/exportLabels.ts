import { message } from "@shared/messages";
import type { ExportOutput, ExportTarget } from "@/types/export";

/** The name the target menu shows for `target`. */
export function targetLabel(target: ExportTarget): string {
  return message(`export.target.${target}`);
}

/** The name the format menu shows for `output`. */
export function outputLabel(output: ExportOutput): string {
  return message(`export.output.${output}`);
}
