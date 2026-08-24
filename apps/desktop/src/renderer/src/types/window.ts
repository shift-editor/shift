import type { FontSession } from "./fontSession";
import type { Workspace } from "@/workspace/Workspace";

declare global {
  interface Window {
    /** Active authored workspace for renderer-console experiments and e2e tests. */
    shift?: Workspace;
    /** Active immutable font-session composition. */
    shiftSession?: FontSession;
  }
}
