import type { FontSession } from "@/types/fontSession";
import { SurfaceActions } from "../SurfaceActions";
import type { ShiftHost } from "@shared/host/ShiftHost";
import { CatalogProbes } from "./CatalogProbes";
import { CanvasTargets } from "./CanvasTargets";
import { InterpolatedReads } from "./InterpolatedReads";
import { PerfProbes } from "./PerfProbes";
import { SessionHooks } from "./SessionHooks";

/**
 * What the E2E hook serves in one window, by the name an `e2e.call` gives
 * each: the test surface's actions (shared with vitest's `TestEditor`), canvas targets
 * for aiming the pointer, the session and catalog facts no reader serves, the drawn-glyph
 * reads waiting on `drawnGlyph`, and perf instrumentation.
 *
 * @remarks
 * Built on the first E2E call, only for E2E launches; see `AgentBridge`.
 */
export interface E2EHooks {
  actions: SurfaceActions;
  canvas: CanvasTargets;
  interpolated: InterpolatedReads;
  session: SessionHooks;
  catalog: CatalogProbes;
  perf: PerfProbes;
}

/** Builds the E2E hooks over one window's font session. */
export function createE2EHooks(session: FontSession, host: ShiftHost): E2EHooks {
  return {
    actions: new SurfaceActions(session.editor),
    canvas: new CanvasTargets(session.editor),
    interpolated: new InterpolatedReads(session.editor),
    session: new SessionHooks(session, host),
    catalog: new CatalogProbes(session),
    perf: new PerfProbes(session.editor),
  };
}
