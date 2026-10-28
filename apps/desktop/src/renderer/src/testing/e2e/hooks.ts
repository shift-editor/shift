import type { FontSession } from "@/types/fontSession";
import { E2EActions } from "./E2EActions";
import { EditorProbes } from "./EditorProbes";
import { InteractionProbes } from "./InteractionProbes";

/**
 * What the E2E hook serves in one window, by the name an `e2e.call` gives
 * each: setup actions, and probes of state agents do not read.
 *
 * @remarks
 * Built on the first E2E call, only for E2E launches; see `AgentBridge`.
 */
export interface E2EHooks {
  actions: E2EActions;
  editor: EditorProbes;
  interactions: InteractionProbes;
}

/** Builds the E2E hooks over one window's font session. */
export function createE2EHooks(session: FontSession): E2EHooks {
  return {
    actions: new E2EActions(session.editor),
    editor: new EditorProbes(session.editor),
    interactions: new InteractionProbes(session.editor),
  };
}

export type E2EHookName = keyof E2EHooks;

/** The methods of the hook named `H`. */
export type E2EHookMethod<H extends E2EHookName> = {
  [M in keyof E2EHooks[H]]: E2EHooks[H][M] extends (...args: never[]) => unknown ? M : never;
}[keyof E2EHooks[H]];

type HookFunction<H extends E2EHookName, M extends E2EHookMethod<H>> = Extract<
  E2EHooks[H][M],
  (...args: never[]) => unknown
>;

/** The arguments `hook.method` takes. */
export type E2EHookArgs<H extends E2EHookName, M extends E2EHookMethod<H>> = Parameters<
  HookFunction<H, M>
>;

/** What `hook.method` returns, awaited. */
export type E2EHookResult<H extends E2EHookName, M extends E2EHookMethod<H>> = Awaited<
  ReturnType<HookFunction<H, M>>
>;
