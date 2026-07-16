import { useSyncExternalStore } from "react";
import { effect, type Signal } from "./signal";

interface UseSignalOptions {
  readonly schedule?: "frame";
}

function scheduleFrame(execute: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(execute);
    return;
  }

  setTimeout(execute, 0);
}

/**
 * React hook to subscribe to a signal's value.
 *
 * Bridges the signal system to React by using useSyncExternalStore
 * with proper subscriptions (no polling).
 *
 * @example
 * const editor = useEditor();
 * const activeTool = useSignalState(editor.activeTool);
 */
export function useSignalState<T>(signal: Signal<T>, options?: UseSignalOptions): T {
  return useSyncExternalStore(
    (callback) => {
      const fx = effect(
        () => {
          signal.value; // Track dependency
          callback();
        },
        options?.schedule === "frame" ? { schedule: scheduleFrame } : undefined,
      );
      return () => fx.dispose();
    },
    () => signal.peek(),
  );
}
