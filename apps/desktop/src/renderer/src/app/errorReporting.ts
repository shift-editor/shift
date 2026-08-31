import type { RendererErrorReport } from "@shared/ipc/contract";
import { getShiftHost } from "@/host/shiftHost";

declare const SHIFT_BUILD_COMMIT: string | undefined;

export function reportRendererError(
  boundaryName: string,
  error: unknown,
  componentStack?: string,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const report: RendererErrorReport = {
    productVersion: null,
    buildCommit: typeof SHIFT_BUILD_COMMIT === "string" ? SHIFT_BUILD_COMMIT : null,
    route: window.location.hash,
    boundaryName,
    message,
    componentStack,
  };

  getShiftHost()
    .errors.reportRenderer(report)
    .catch((reportError) => {
      console.error("renderer error report failed", reportError);
    });
}
