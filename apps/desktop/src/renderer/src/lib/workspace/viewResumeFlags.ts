export type ViewResumeFlow = "conversion" | "crashReopen" | "relaunch" | "update";

const ENABLED_FLOWS: ReadonlySet<ViewResumeFlow> = new Set([
  "conversion",
  "crashReopen",
  "relaunch",
  "update",
]);

export function isViewResumeRestoreEnabled(flow: ViewResumeFlow): boolean {
  return ENABLED_FLOWS.has(flow);
}
