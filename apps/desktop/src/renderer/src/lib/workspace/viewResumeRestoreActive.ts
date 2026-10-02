import { isViewResumeRestoreEnabled, type ViewResumeFlow } from "./viewResumeFlags";

const RESTORE_FLOWS: ViewResumeFlow[] = ["conversion", "crashReopen", "relaunch", "update"];

export function viewResumeRestoreActive(): boolean {
  return RESTORE_FLOWS.some((flow) => isViewResumeRestoreEnabled(flow));
}
