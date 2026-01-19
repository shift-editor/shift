import { useSyncExternalStore } from "react";
import { effect, type Signal } from "./signal";

/**
 * React hook to subscribe to a signal's value.
 *
 * Bridges the signal system to React by using useSyncExternalStore
 * with proper subscriptions (no polling).
 *
 * @example
 * const editor = getEditor();
 * const activeTool = useSignalValue(editor.activeToolSignal);
 */
export function useSignalValue<T>(signal: Signal<T>): T {
  return useSyncExternalStore(
    (callback) => {
      const fx = effect(() => {
        signal.value; // Track dependency
        callback();
      });
      return () => fx.dispose();
    },
    () => signal.peek(),
  );
}
